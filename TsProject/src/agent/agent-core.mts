/**
 * Agent Core Module
 * Uses Vercel AI SDK to interact with LLM APIs.
 */
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { createScreenshotTools } from '../tools/screenshot-tool.mjs';
import { createEvalTools } from '../tools/eval-tool.mjs';
import { buildSystemPrompt } from './prompt.mjs';
import { imageStore, stripOldUserImages, replaceImageStringsInPlace, createRetrieveImageTool } from './image-store.mjs';
import {
    ENABLE_SLIDING_WINDOW, MAX_INPUT_TOKENS, MIN_KEEP_MESSAGES,
    estimateTokens, pruneOldToolOutputs, trimMessagesByTokenBudget,
    getHistorySummary, resetHistorySummary,
} from './compaction.mjs';



/**
 * AbortController for the current generation.
 * Created at the start of each runGeneration() call;
 * calling abortGeneration() triggers the signal so
 * generateText stops as soon as possible.
 */
let currentAbortController: AbortController | null = null;



/**
 * Maximum number of tool-call steps allowed per generateText invocation.
 * When this limit is reached, the agent pauses and asks the user whether to continue.
 */
const MAX_STEPS = 25;

/**
 * Prefix used to signal the C# UI that the response hit the step limit.
 * The UI should detect this prefix and show a "Continue" button.
 */
const STEP_LIMIT_PREFIX = '[STEP_LIMIT_REACHED]';

// Agent configuration interface
export interface AgentConfig {
    apiKey: string;
    baseURL?: string;
    model?: string;
    /** Optional: a cheaper / faster model ID used for summarizing trimmed history.
     *  If not set, the main model is used. */
    summaryModel?: string;
}



// Default configuration (system prompt is NOT part of the config — it is managed by TS only)
const DEFAULT_CONFIG: AgentConfig = {
    apiKey: '',
    model: 'gpt-4o-mini',
};

// Conversation history
let conversationHistory: ModelMessage[] = [];
let currentConfig: AgentConfig = { ...DEFAULT_CONFIG };
let isConfigured = false;



/**
 * Check whether a tool result output indicates success.
 * - If output is an object with a `success` boolean field, use it directly.
 * - If output is a string containing failure keywords, treat as failure.
 * - Otherwise assume success.
 */
function isToolResultSuccess(output: unknown): boolean {
    if (output != null && typeof output === 'object' && 'success' in (output as any)) {
        return !!(output as any).success;
    }
    if (typeof output === 'string') {
        const lower = output.toLowerCase();
        if (lower.includes('failed') || lower.includes('error')) {
            return false;
        }
    }
    return true;
}

/**
 * Extract an error message from a tool result output.
 */
function extractToolErrorMessage(output: unknown): string {
    if (output != null && typeof output === 'object') {
        const obj = output as any;
        if (obj.error) return String(obj.error);
        if (obj.message) return String(obj.message);
    }
    if (typeof output === 'string') {
        return output.length > 200 ? output.substring(0, 200) + '...' : output;
    }
    return 'Unknown error';
}







// ============================================================
// Agent API
// ============================================================

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



// ============================================================
// Shared helpers for sendMessage / continueGeneration
// ============================================================

/**
 * Create the full tool set used by the agent.
 */
function createToolSet() {
    return {
        ...createScreenshotTools(),
        ...createEvalTools(),
        ...createRetrieveImageTool(),
    };
}

/**
 * Create an OpenAI provider and chat model from the current config.
 */
function createModel() {
    const provider = createOpenAI({
        apiKey: currentConfig.apiKey,
        baseURL: currentConfig.baseURL,
    });
    return provider.chat(currentConfig.model || 'gpt-4o-mini');
}

/**
 * onStepFinish callback for generateText.
 * Reports tool call results and intermediate text to the UI via onProgress.
 */
function handleStepFinish(onProgress: ((text: string) => void) | undefined, { stepNumber, text, toolCalls, toolResults, finishReason }: any): void {
    if (!onProgress) return;

    const hasToolResults = toolResults && toolResults.length > 0;
    const hasToolCalls = toolCalls && toolCalls.length > 0;

    let progressText = '';
    if (hasToolResults) {
        for (const tr of toolResults) {
            const ok = isToolResultSuccess(tr.output);
            if (ok) {
                progressText += `call ${tr.toolName} <color=#4CAF50>[OK]</color>\n`;
            } else {
                const errMsg = extractToolErrorMessage(tr.output);
                progressText += `call ${tr.toolName} <color=#F44336>[FAIL]</color>: ${errMsg}\n`;
            }
        }
    } else if (hasToolCalls) {
        for (const tc of toolCalls) {
            progressText += `<color=#FFA726>[CALL]</color> ${tc.toolName}\n`;
        }
    }

    // Only include intermediate text when it accompanies tool calls.
    // If a step is pure text with no tool calls (i.e. the final response),
    // skip it here — it will be shown via FinalizeProgressBubble's finalText.
    if (text && (hasToolResults || hasToolCalls)) {
        const truncatedText = text.length > 500 ? text.substring(0, 500) + '...' : text;
        progressText += truncatedText;
    }
    if (progressText) {
        onProgress(progressText.trim());
    }
}

/**
 * prepareStep callback for generateText.
 * Handles big-string compression, sliding-window trimming,
 * and screenshot image extraction.
 */
function handlePrepareStep({ messages, stepNumber, steps }: any): any {
    if (stepNumber === 0) return undefined;

    // ---- Diagnostic: log message identities to check if AI SDK rebuilds them ----
    const lastFew = messages.slice(-3).map((m: any, i: number) => {
        const role = m.role || '?';
        const contentPreview = typeof m.content === 'string'
            ? m.content.substring(0, 40)
            : (Array.isArray(m.content) ? `[${m.content.length} parts]` : '?');
        return `${role}:${contentPreview}`;
    });
    console.log(`[Agent] prepareStep(${stepNumber}): ${messages.length} msgs, last3=[${lastFew.join(' | ')}]`);

    let newMessages = messages;

    // ---- (1) Sliding window: check actual token usage from last step ----
    if (ENABLE_SLIDING_WINDOW) {
        // 工具的调用过程中也可能产生token超标的情况，如果超了，会prune，还超就emergency trim，而prepareHistory是prune+compaction
        const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
        const lastInputTokens = lastStep?.usage?.inputTokens;
        const overBudget = lastInputTokens
            ? lastInputTokens > MAX_INPUT_TOKENS
            : estimateTokens(newMessages) > MAX_INPUT_TOKENS;

        if (overBudget) {
            const source = lastInputTokens ? `actual ${lastInputTokens}` : `estimated ${estimateTokens(newMessages)}`;
            console.log(`[Agent] prepareStep(${stepNumber}): ${source} tokens exceeds ${MAX_INPUT_TOKENS}`);

            // Phase 1: prune old tool outputs (synchronous, no LLM call)
            const prunedTokens = pruneOldToolOutputs(newMessages);
            if (prunedTokens > 0) {
                console.log(`[Agent] prepareStep(${stepNumber}): pruned ~${prunedTokens} tokens from old tool outputs`);
            }

            // Re-check after pruning
            const afterPrune = estimateTokens(newMessages);
            if (afterPrune > MAX_INPUT_TOKENS) {
                // Phase 2: emergency trim (synchronous — cannot call async compaction here)
                console.log(`[Agent] prepareStep(${stepNumber}): still ${afterPrune} tokens after pruning, emergency trim...`);
                const keep = Math.min(MIN_KEEP_MESSAGES, newMessages.length);
                const trimmedMsgs = newMessages.slice(newMessages.length - keep);
                const summary = getHistorySummary();
                if (summary) {
                    trimmedMsgs.unshift({
                        role: 'user' as const,
                        content: `[Compacted Context — this is a structured summary of earlier conversation that was compacted to save context space]:\n${summary}`,
                    } as any);
                }
                newMessages = trimmedMsgs;
                console.log(`[Agent] prepareStep(${stepNumber}): trimmed to ${newMessages.length} messages`);
            }
        }
    }

    // ---- (2) Extract screenshot images from the last tool message ----
    // If messages were modified (compressed in-place or trimmed), we need to
    // return them. Trimming creates a new array, so check identity.
    const modified = newMessages !== messages;

    const lastMsg = newMessages[newMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'tool') {
        return modified ? { messages: newMessages } : undefined;
    }

    const imageParts: Array<any> = [];
    const patchedContent: any[] = [];

    for (const part of lastMsg.content as any[]) {
        if (
            part.type === 'tool-result' &&
            part.output?.type === 'content' &&
            Array.isArray(part.output.value)
        ) {
            const textItems: any[] = [];
            for (const item of part.output.value) {
                if (item.type === 'file-data' && item.mediaType?.startsWith('image/')) {
                    imageParts.push({
                        type: 'image' as const,
                        image: item.data,
                        mediaType: item.mediaType,
                    });
                } else {
                    textItems.push(item);
                }
            }

            if (imageParts.length > 0) {
                patchedContent.push({
                    ...part,
                    output: textItems.length > 0
                        ? { type: 'content' as const, value: textItems }
                        : { type: 'text' as const, value: textItems.map((t: any) => t.text || '').join('\n') || 'Screenshot captured.' },
                });
            } else {
                patchedContent.push(part);
            }
        } else {
            patchedContent.push(part);
        }
    }

    if (imageParts.length > 0) {
        console.log(`[Agent] prepareStep(${stepNumber}): injecting ${imageParts.length} screenshot image(s) as user message`);
        // Mutate the tool message in-place so the AI SDK's internal reference
        // is also updated, preventing the same base64 from reappearing in later steps.
        lastMsg.content = patchedContent; // 删除了原有的工具里的base64
        newMessages.push({
            role: 'user',
            content: [
                ...imageParts,
                {
                    type: 'text' as const,
                    text: 'Above is the screenshot I just captured. Please analyze it and respond to my earlier request.',
                },
            ],
        } as any);// 由于handlePrepareStep传入下消息是由const stepInputMessages = [...initialMessages, ...responseMessages];拼接出来的，所有这里并不会影响到initialMessages，responseMessages
        // 发完就没有了
        // 所以截图工具的base64不会被压缩
    }

    return { messages: newMessages };
}



/**
 * Compress history and apply sliding-window trimming.
 * Shared pre-processing for both sendMessage and continueGeneration.
 */
async function prepareHistory(): Promise<void> {
    // Compress base64 image strings in tool results with placeholders
    for (const msg of conversationHistory) {
        replaceImageStringsInPlace(msg);
    }

    stripOldUserImages(conversationHistory);

    if (ENABLE_SLIDING_WINDOW) {
        const estimated = estimateTokens(conversationHistory);
        if (estimated > MAX_INPUT_TOKENS) {
            const { messages: trimmed, trimmed: didTrim } = await trimMessagesByTokenBudget(
                conversationHistory, MAX_INPUT_TOKENS, currentConfig,
            );
            if (didTrim) {
                conversationHistory = trimmed as ModelMessage[];
            }
        }
    }
}

/**
 * Core generation logic shared by sendMessage and continueGeneration.
 * Calls generateText, appends response messages to history, handles
 * step-limit detection and errors.
 *
 * @param onProgress  Optional progress callback for the UI.
 * @param logPrefix   Log prefix for prepareStep messages.
 * @returns The assistant's text response.
 */
async function runGeneration(onProgress?: (text: string) => void): Promise<string> {
    // Create a fresh AbortController for this generation
    currentAbortController = new AbortController();
    const abortSignal = currentAbortController.signal;

    try {
        const model = createModel();
        const tools = createToolSet();

        const result = await generateText({
            model,
            system: buildSystemPrompt(imageStore.imagePrefix),
            messages: conversationHistory,
            tools,
            abortSignal,
            stopWhen: stepCountIs(MAX_STEPS),
            onStepFinish: (stepResult) => handleStepFinish(onProgress, stepResult),
            prepareStep: handlePrepareStep,
        });

        // Append all response messages (assistant + tool) to conversation history
        for (const msg of result.response.messages) {
            conversationHistory.push(msg as ModelMessage);
        }

        // Check if the step limit was reached
        if (result.steps.length >= MAX_STEPS) {
            const partialText = result.text || '';
            console.log(`[Agent] Reached max steps (${MAX_STEPS}). Pausing for user confirmation.`);
            return `${STEP_LIMIT_PREFIX}${partialText}`;
        }

        return result.text;
    } catch (error: any) {
        // Check if the error is an abort
        if (abortSignal.aborted) {
            console.log('[Agent] Generation was aborted by user.');
            // Keep the user message in history (don't pop) so context is preserved
            return '[Agent] Generation stopped by user.';
        }

        const errorMsg = `[Agent] Error: ${error.message || String(error)}`;
        console.error(errorMsg);

        // Remove the last user message from history on failure
        conversationHistory.pop();

        return errorMsg;
    } finally {
        currentAbortController = null;
    }
}

/**
 * Send a message to the LLM and get a response.
 * This is the main async function called from C#.
 *
 * Uses maxSteps for automatic tool-call looping. A prepareStep hook
 * intercepts screenshot images from tool results and re-injects them
 * as user-message image parts, because the Chat Completions API
 * converter only JSON.stringifies tool-result content (no image_url).
 */
export async function sendMessage(userMessage: string, imageBase64?: string, imageMimeType?: string, onProgress?: (text: string) => void): Promise<string> {
    if (!isConfigured || !currentConfig.apiKey) {
        return '[Agent] Not configured. Please set API key first via the Settings panel.';
    }

    // Add user message to history FIRST (so that prepareHistory can see the
    // latest user message when deciding which images to strip).
    if (imageBase64 && imageMimeType) {
        console.log(`[Agent] Message includes attached image (${imageMimeType}, ${imageBase64.length} base64 chars)`);
        conversationHistory.push({
            role: 'user',
            content: [
                {
                    type: 'image' as const,
                    image: imageBase64,
                    mediaType: imageMimeType,
                } as any,
                {
                    type: 'text' as const,
                    text: userMessage,
                },
            ],
        });
    } else {
        conversationHistory.push({
            role: 'user',
            content: userMessage,
        });
    }

    // Compress & trim history (after push so stripOldUserImages sees the new user msg)
    await prepareHistory();

    return runGeneration(onProgress);
}

/**
 * Continue generation after the step limit was reached.
 * Re-invokes generateText with the existing conversationHistory (which already
 * contains all previous assistant + tool messages) so the agent picks up
 * where it left off.
 */
export async function continueGeneration(onProgress?: (text: string) => void): Promise<string> {
    if (!isConfigured || !currentConfig.apiKey) {
        return '[Agent] Not configured. Please set API key first via the Settings panel.';
    }

    console.log('[Agent] Continuing generation from where it left off...');

    // Add user message FIRST (so prepareHistory sees it as the latest user msg)
    conversationHistory.push({
        role: 'user',
        content: 'Please continue. Pick up from where you left off and keep working on the task.',
    });

    // Compress & trim history
    await prepareHistory();

    return runGeneration(onProgress);
}

/**
 * Abort the current in-flight generation, if any.
 * Safe to call even when no generation is running.
 */
export function abortGeneration(): void {
    if (currentAbortController) {
        console.log('[Agent] Aborting current generation...');
        currentAbortController.abort();
    } else {
        console.log('[Agent] No generation in progress to abort.');
    }
}

/**
 * Clear conversation history.
 */
export function clearHistory(): void {
    conversationHistory = [];
    imageStore.clear();
    resetHistorySummary();
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
