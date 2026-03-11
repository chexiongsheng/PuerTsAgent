// LLM Agent Entry Module

console.log("[Agent] LLM Agent initialized.");

/**
 * LLM Agent Entry Module
 * This is the main entry point loaded by PuerTS.
 */
import './polyfills/streams-polyfill.mjs';
import './polyfills/fetch-polyfill.mjs';
import {
    configure,
    sendMessage,
    clearHistory,
    getHistoryLength,
    getIsConfigured,
} from './agent/agent-core.mjs';

// Start capturing Unity logs for the agent's log tool
CS.LLMAgent.UnityLogBridge.StartListening();

console.log('[Agent] LLM Agent module loaded.');

/**
 * Configure the agent with API settings.
 * Called from C# side.
 */
export function configureAgent(
    apiKey: string,
    baseURL: string,
    model: string
): string {
    return configure({
        apiKey,
        baseURL: baseURL || undefined,
        model: model || undefined,
    });
}

/**
 * Handle incoming user message with direct callback pattern.
 * C# passes an Action<string, bool> callback directly, TS calls callback() when done.
 *
 * @param message - User input text
 * @param callback - C# Action<string, bool> callback to invoke with (response, isError)
 */
export function onMessageReceived(message: string, imageBase64: string, imageMimeType: string, callback: CS.System.Action$2<string, boolean>): void {
    console.log(`[Agent] User said: ${message}${imageBase64 ? ' (with image)' : ''}`);

    if (!getIsConfigured()) {
        // Immediately callback with error
        callback.Invoke!('[Agent] Not configured. Please set your API key in Settings.', false);
        return;
    }

    // Fire and forget - the async operation will call back when done
    sendMessage(message, imageBase64 || undefined, imageMimeType || undefined)
        .then((response: string) => {
            callback.Invoke!(response, false);
        })
        .catch((error: any) => {
            const errorMsg = `[Agent] Error: ${error.message || String(error)}`;
            console.error(errorMsg);
            callback.Invoke!(errorMsg, true);
        });
}

/**
 * Synchronous message handler for simple echo/test (no LLM call).
 * Called from C# side.
 */
export function onMessageSync(message: string): string {
    if (!getIsConfigured()) {
        return '[Agent] Not configured. Please set your API key in Settings.';
    }
    return `[Echo] ${message}`;
}

/**
 * Clear conversation history.
 * Called from C# side.
 */
export function onClearHistory(): void {
    clearHistory();
}

/**
 * Get conversation history length.
 * Called from C# side.
 */
export function onGetHistoryLength(): number {
    return getHistoryLength();
}

/**
 * Check if agent is configured.
 * Called from C# side.
 */
export function onIsConfigured(): boolean {
    return getIsConfigured();
}
