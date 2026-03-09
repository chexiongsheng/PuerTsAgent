/**
 * Agent Core Module
 * Uses Vercel AI SDK to interact with LLM APIs.
 */
import { generateText, type CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createUnityLogTools } from '../tools/unity-log-tool.mjs';
import { createScreenshotTools } from '../tools/screenshot-tool.mjs';

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
        // Create OpenAI provider with our config
        const provider = createOpenAI({
            apiKey: currentConfig.apiKey,
            baseURL: currentConfig.baseURL,
            // Note: fetch is picked up from globalThis.fetch (our polyfill)
        });

        const model = provider(currentConfig.model || 'gpt-4o-mini');

        // Create tools for the agent
        const tools = {
            ...createUnityLogTools(),
            ...createScreenshotTools(),
        };

        const result = await generateText({
            model,
            system: currentConfig.systemPrompt,
            messages: conversationHistory,
            tools,
            maxSteps: 5,
        });

        const assistantMessage = result.text;

        // Add assistant response to history
        conversationHistory.push({
            role: 'assistant',
            content: assistantMessage,
        });

        return assistantMessage;
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
