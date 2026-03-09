/**
 * Agent Core Module
 * Uses Vercel AI SDK to interact with LLM APIs.
 */
import { generateText, type CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createUnityLogTools } from '../tools/unity-log-tool.mjs';
import { createScreenshotTools } from '../tools/screenshot-tool.mjs';
import { createTypeReflectionTools } from '../tools/type-reflection-tool.mjs';

// Agent configuration interface
export interface AgentConfig {
    apiKey: string;
    baseURL?: string;
    model?: string;
    systemPrompt?: string;
}

// Default configuration
const DEFAULT_CONFIG: AgentConfig = {
    apiKey: '',
    model: 'gpt-4o-mini',
    systemPrompt: 'You are a helpful AI assistant running inside Unity Editor. You can help with game development, scripting, and general questions. Be concise and practical.',
};

// Conversation history
let conversationHistory: CoreMessage[] = [];
let currentConfig: AgentConfig = { ...DEFAULT_CONFIG };
let isConfigured = false;

/**
 * Configure the agent with API credentials and settings.
 */
export function configure(config: Partial<AgentConfig>): string {
    currentConfig = { ...DEFAULT_CONFIG, ...config };

    if (!currentConfig.apiKey) {
        isConfigured = false;
        return '[Agent] Error: API key is required. Call configure({ apiKey: "your-key" }) first.';
    }

    isConfigured = true;
    console.log(`[Agent] Configured with model: ${currentConfig.model}, baseURL: ${currentConfig.baseURL || 'default'}`);
    return `[Agent] Configured successfully. Model: ${currentConfig.model}`;
}

/**
 * Send a message to the LLM and get a response.
 * This is the main async function called from C#.
 *
 * We implement a manual tool-call loop instead of relying on maxSteps,
 * because the OpenAI provider's convertToOpenAIChatMessages does NOT
 * support images inside tool-result messages. By handling the loop
 * ourselves, we can inject screenshot images as user-message image parts
 * (which the provider correctly converts to image_url).
 */
export async function sendMessage(userMessage: string): Promise<string> {
    if (!isConfigured || !currentConfig.apiKey) {
        return '[Agent] Not configured. Please set API key first via the Settings panel.';
    }

    // Add user message to history
    conversationHistory.push({
        role: 'user',
        content: userMessage,
    });

    try {
        const provider = createOpenAI({
            apiKey: currentConfig.apiKey,
            baseURL: currentConfig.baseURL,
        });

        const model = provider(currentConfig.model || 'gpt-4o-mini');

        // Create tools for the agent
        const tools = {
            ...createUnityLogTools(),
            ...createScreenshotTools(),
            ...createTypeReflectionTools(),
        };

        const MAX_STEPS = 5;

        for (let step = 0; step < MAX_STEPS; step++) {
            const result = await generateText({
                model,
                system: currentConfig.systemPrompt,
                messages: conversationHistory,
                tools,
                maxSteps: 1,  // single step — we manage the loop
            });

            const toolCalls = result.toolCalls;
            const toolResults = result.toolResults;

            // If the model produced tool calls, process them and continue the loop
            if (toolCalls && toolCalls.length > 0 && toolResults && toolResults.length > 0) {
                // 1. Push the assistant message with tool calls
                conversationHistory.push({
                    role: 'assistant',
                    content: toolCalls.map(tc => ({
                        type: 'tool-call' as const,
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        args: tc.args,
                    })),
                });

                // 2. Build tool-result messages, and collect any images to inject
                const toolResultParts: CoreMessage['content'] extends infer T ? T extends any[] ? T : never : never = [];
                const imageParts: Array<{ type: 'image'; image: string; mimeType: string }> = [];

                for (const tr of toolResults) {
                    const execResult = tr.result as any;

                    // For screenshot tool: extract the base64 image data
                    if (tr.toolName === 'captureScreenshot' && execResult?.success && execResult?.base64) {
                        // Store image to inject as a user message later
                        imageParts.push({
                            type: 'image' as const,
                            image: execResult.base64,
                            mimeType: 'image/png',
                        });

                        // Push a text-only tool result (no base64 blob to waste tokens)
                        toolResultParts.push({
                            type: 'tool-result' as const,
                            toolCallId: tr.toolCallId,
                            toolName: tr.toolName,
                            result: {
                                success: true,
                                message: execResult.message || `Screenshot captured (${execResult.width}x${execResult.height}).`,
                                width: execResult.width,
                                height: execResult.height,
                            },
                        } as any);
                    } else {
                        toolResultParts.push({
                            type: 'tool-result' as const,
                            toolCallId: tr.toolCallId,
                            toolName: tr.toolName,
                            result: execResult,
                        } as any);
                    }
                }

                // 3. Push tool results
                conversationHistory.push({
                    role: 'tool',
                    content: toolResultParts as any,
                });

                // 4. If there were screenshot images, inject them as a user message
                //    so the OpenAI provider sends them as proper image_url parts.
                if (imageParts.length > 0) {
                    console.log(`[Agent] Injecting ${imageParts.length} screenshot image(s) as user message`);
                    conversationHistory.push({
                        role: 'user',
                        content: [
                            ...imageParts as any,
                            {
                                type: 'text' as const,
                                text: 'Above is the screenshot I just captured. Please analyze it and respond to my earlier request.',
                            },
                        ],
                    });
                }

                // Continue loop — model will see the tool results + images
                continue;
            }

            // No tool calls — model produced a final text response
            const assistantMessage = result.text;
            conversationHistory.push({
                role: 'assistant',
                content: assistantMessage,
            });

            return assistantMessage;
        }

        // If we exhausted all steps, return whatever we got last
        return '[Agent] Reached maximum tool call steps. Please try again with a simpler request.';
    } catch (error: any) {
        const errorMsg = `[Agent] Error: ${error.message || String(error)}`;
        console.error(errorMsg);

        // Remove the failed user message from history
        conversationHistory.pop();

        return errorMsg;
    }
}

/**
 * Clear conversation history.
 */
export function clearHistory(): void {
    conversationHistory = [];
    console.log('[Agent] Conversation history cleared.');
}

/**
 * Get the current conversation history length.
 */
export function getHistoryLength(): number {
    return conversationHistory.length;
}

/**
 * Check if the agent is configured.
 */
export function getIsConfigured(): boolean {
    return isConfigured;
}
