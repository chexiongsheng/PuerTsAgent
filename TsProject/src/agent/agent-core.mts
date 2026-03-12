/**
 * Agent Core Module
 * Uses Vercel AI SDK to interact with LLM APIs.
 */
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { tool } from 'ai';
import { z } from 'zod';
import { createUnityLogTools } from '../tools/unity-log-tool.mjs';
import { createScreenshotTools } from '../tools/screenshot-tool.mjs';
import { createTypeReflectionTools } from '../tools/type-reflection-tool.mjs';
import { createEvalTools } from '../tools/eval-tool.mjs';

// ============================================================
// BigStringStore – stores large strings replaced by placeholders
// ============================================================

/** Generate a random alphanumeric suffix of the given length. */
function randomSuffix(len: number = 5): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

/** Metadata about a stored big string entry. */
interface BigStringEntry {
    content: string;
    length: number;
    /** A short hint about what this content is, e.g. "code", "eval_result", "screenshot_base64". */
    contentType: string;
    /** If true, content cannot be meaningfully retrieved as text (e.g. base64 image data). */
    nonRetrievable: boolean;
}

class BigStringStore {
    private entries: BigStringEntry[] = [];
    /** Unique prefix for placeholders in this session, e.g. "bigstr_a3f9x". */
    readonly prefix: string;
    /** Prefix for non-retrievable image placeholders, e.g. "image_a3f9x". */
    readonly imagePrefix: string;

    constructor() {
        const suffix = randomSuffix(5);
        this.prefix = `bigstr_${suffix}`;
        this.imagePrefix = `image_${suffix}`;
    }

    /** Store a string and return its index. */
    store(content: string, contentType: string, nonRetrievable: boolean = false): number {
        const index = this.entries.length;
        this.entries.push({ content, length: content.length, contentType, nonRetrievable });
        return index;
    }

    /** Build a placeholder string for a stored entry. */
    placeholder(index: number, length: number, contentType: string, nonRetrievable: boolean): string {
        if (nonRetrievable) {
            return `${this.imagePrefix}(${index}, ${length})`;
        }
        return `${this.prefix}(${index}, ${length}, "${contentType}")`;
    }

    /** Retrieve a stored string by index. Returns null if not found or non-retrievable. */
    retrieve(index: number): { content: string; contentType: string } | null {
        if (index < 0 || index >= this.entries.length) return null;
        const entry = this.entries[index];
        if (entry.nonRetrievable) return null;
        return { content: entry.content, contentType: entry.contentType };
    }

    /** Get entry metadata without content. */
    getMeta(index: number): { length: number; contentType: string; nonRetrievable: boolean } | null {
        if (index < 0 || index >= this.entries.length) return null;
        const { length, contentType, nonRetrievable } = this.entries[index];
        return { length, contentType, nonRetrievable };
    }

    /** Clear all stored entries and regenerate prefix. */
    clear(): void {
        this.entries = [];
        const suffix = randomSuffix(5);
        (this as any).prefix = `bigstr_${suffix}`;
        (this as any).imagePrefix = `image_${suffix}`;
    }

    get size(): number {
        return this.entries.length;
    }
}

let bigStringStore = new BigStringStore();

/**
 * Minimum string length to trigger replacement with a placeholder.
 * Strings shorter than this are kept inline to avoid unnecessary tool calls.
 */
const BIG_STRING_THRESHOLD = 500;

// ============================================================
// Token estimation & sliding window constants
// ============================================================

/**
 * =========================================================
 *  SLIDING WINDOW TOGGLE
 *  Set to `false` to completely disable the sliding-window
 *  context management (automatic message trimming &
 *  history summarization). Useful for debugging.
 * =========================================================
 */
const ENABLE_SLIDING_WINDOW = true;

/**
 * Approximate ratio of characters to tokens for English/code mixed content.
 * Used as a fallback when precise token counts are unavailable.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Maximum input token budget. When the estimated (or actual) input token count
 * exceeds this value, older messages are trimmed.
 * Default: 600 000 tokens (safe for most 1M-context models).
 */
const MAX_INPUT_TOKENS = 600_000;

/**
 * Minimum number of recent messages to always keep, even during aggressive trimming.
 * This protects the current user request + the most recent assistant/tool exchanges.
 */
const MIN_KEEP_MESSAGES = 6;

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

/**
 * Character budget for the summary of trimmed messages.
 * The summary prompt instructs the LLM to stay within this limit.
 */
const SUMMARY_MAX_CHARS = 2000;

// Agent configuration interface
export interface AgentConfig {
    apiKey: string;
    baseURL?: string;
    model?: string;
    /** Optional: a cheaper / faster model ID used for summarizing trimmed history.
     *  If not set, the main model is used. */
    summaryModel?: string;
}

/** System prompt is managed entirely by the TS side and cannot be overridden from C#. */
const SYSTEM_PROMPT = `You are a helpful AI assistant running inside Unity via PuerTS (a TypeScript/JavaScript runtime for Unity). You can help with game development, scripting, and general questions. Be concise and practical.

## Context Compression — Placeholder System

To save context space, large strings in **past** tool calls (both request parameters
and results) are automatically replaced with compact placeholders.
The placeholder prefixes are unique per session and will be told to you here:

- \`{BIGSTR_PREFIX}(index, length, "type")\` - a text string that was replaced.
  \`index\` is the storage slot, \`length\` is the original character count,
  and \`type\` describes the content (e.g. "code", "eval_result").
  **You can retrieve the original content** by calling the \`retrieveBigString\` tool with the index.
  Only retrieve it when you genuinely need the exact content — in most cases the
  surrounding context is enough.

- \`{IMAGE_PREFIX}(index, length)\` - a base64-encoded image that was replaced.
  These **cannot** be retrieved as text. If you need to see the screenshot again,
  call the \`captureScreenshot\` tool to take a fresh one.

## PuerTS: JS ↔ C# Interop Rules

You are running in a PuerTS environment. Below are the rules for interacting between JavaScript/TypeScript and C#.

### JS Calling C#

1. **Access C# classes**: Use the global \`CS\` object with the full namespace path.
   \`\`\`js
   const Vector3 = CS.UnityEngine.Vector3;
   const go = new CS.UnityEngine.GameObject("myObj");
   \`\`\`

2. **Call methods & access properties**: Same syntax as C#.
   \`\`\`js
   CS.UnityEngine.Debug.Log("Hello World");
   const rect = new CS.UnityEngine.Rect(0, 0, 2, 2);
   console.log(rect.Contains(CS.UnityEngine.Vector2.one)); // True
   rect.width = 0.1;
   \`\`\`

3. **out / ref parameters**: Use \`puer.$ref()\` to create a ref container, \`puer.$unref()\` to read the value.
   \`\`\`js
   let p1 = puer.$ref();       // for out param
   let p2 = puer.$ref(10);     // for ref param with initial value
   let ret = CS.Example.InOutArgFunc(100, p1, p2);
   console.log(puer.$unref(p1), puer.$unref(p2));
   \`\`\`

4. **Generics**: Use \`puer.$generic()\` to construct generic types. TypeScript generics are compile-time only; runtime requires this helper.
   \`\`\`js
   let List = puer.$generic(CS.System.Collections.Generic.List$1, CS.System.Int32);
   let lst = new List();
   lst.Add(1);
   \`\`\`

5. **typeof**: Use \`puer.$typeof()\` instead of C#'s \`typeof\` keyword.
   \`\`\`js
   go.AddComponent(puer.$typeof(CS.UnityEngine.ParticleSystem));
   \`\`\`

6. **Array & Indexer access (C# \`[]\` operator)**: C#'s \`[]\` operator does **NOT** map to JS \`[]\`. You must use \`get_Item(index)\` / \`set_Item(index, value)\` methods instead. This applies to C# arrays, Lists, Dictionaries, and any type with an indexer.
   \`\`\`js
   // Create a C# array
   let arr = CS.System.Array.CreateInstance(puer.$typeof(CS.System.Int32), 3);
   arr.set_Item(0, 42);       // arr[0] = 42 in C#
   let val = arr.get_Item(0); // val = arr[0] in C#

   // Same for List<T>, Dictionary<K,V>, etc.
   let List = puer.$generic(CS.System.Collections.Generic.List$1, CS.System.Int32);
   let lst = new List();
   lst.Add(10);
   let first = lst.get_Item(0); // first = lst[0] in C#
   lst.set_Item(0, 20);         // lst[0] = 20 in C#
   \`\`\`

7. **Operator overloading**: JS does not support operator overloading; use \`op_Xxx\` methods instead.
   \`\`\`js
   let ret = CS.UnityEngine.Vector3.op_Multiply(CS.UnityEngine.Vector3.up, 1600);
   // (0.0, 1600.0, 0.0)
   \`\`\`

8. **Async / Task**: Wrap C# Task with \`puer.$promise()\` to await in JS.
   \`\`\`js
   let task = obj.GetFileLengthAsync("path");
   let result = await puer.$promise(task);
   \`\`\`

9. **console.log**: In PuerTS, \`console.log\` is intercepted and internally calls \`UnityEngine.Debug.Log\`.

### C# Calling JS

1. **Via Delegate**: PuerTS can convert a JS function to a C# delegate (Action / Func / custom delegate). The JS side passes a function, C# stores it as a delegate and invokes it.
   \`\`\`js
   // JS side — pass a function where C# expects a delegate
   obj.AddEventCallback1(str => console.log(str));
   obj.Trigger(); // C# fires the delegate, JS function runs
   \`\`\`

2. **Passing parameters from C# to JS**: Convert JS function to a parameterized delegate. Type conversion follows the same rules as C# return values to JS.
   \`\`\`csharp
   // C# side
   System.Action<int> LogInt = env.Eval<System.Action<int>>("(function(a){ console.log(a); })");
   LogInt(3); // prints 3
   \`\`\`

3. **Getting return values from JS**: Use \`Func<>\` delegate instead of \`Action<>\`.
   \`\`\`csharp
   // C# side
   System.Func<int, int> Add3 = env.Eval<System.Func<int, int>>("(function(a){ return 3 + a; })");
   Console.WriteLine(Add3(1)); // 4
   \`\`\`

### Important Notes
- The \`CS\` global object is always available in the PuerTS JS environment for accessing any C# type.
- The \`puer\` global object provides PuerTS helper APIs: \`$ref\`, \`$unref\`, \`$generic\`, \`$typeof\`, \`$promise\`.
`;

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
 * Stores the summary of previously trimmed messages, if any.
 * This is prepended to the messages when sending to the LLM so the agent
 * doesn't completely "forget" earlier context.
 */
let historySummary: string | null = null;

// ============================================================
// History compression – replace big strings with placeholders
// ============================================================

/**
 * Determine a human-friendly content type label for a big string
 * found in a specific context.
 */
function inferContentType(key: string, _value: string): string {
    if (key === 'code') return 'code';
    if (key === 'result') return 'eval_result';
    if (key === 'stack') return 'stack_trace';
    if (key === 'error') return 'error';
    if (key === 'data' || key === 'base64' || key === 'image') return 'image_base64';
    return 'text';
}

/**
 * Recursively walk a JSON-like value and replace large string leaves
 * with placeholders. Operates on a **deep clone** – the original is never mutated.
 */
function replaceBigStrings(obj: any, parentKey: string = ''): any {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        if (obj.length >= BIG_STRING_THRESHOLD) {
            const ctype = inferContentType(parentKey, obj);
            const isImage = ctype === 'image_base64';
            const idx = bigStringStore.store(obj, ctype, isImage);
            return bigStringStore.placeholder(idx, obj.length, ctype, isImage);
        }
        return obj;
    }

    if (Array.isArray(obj)) {
        const out = new Array(obj.length);
        for (let i = 0; i < obj.length; i++) {
            out[i] = replaceBigStrings(obj[i], parentKey);
        }
        return out;
    }

    if (typeof obj === 'object') {
        const out: any = {};
        for (const key of Object.keys(obj)) {
            out[key] = replaceBigStrings(obj[key], key);
        }
        return out;
    }

    return obj;
}

/**
 * Compress big strings inside a single message (non-mutating).
 * Returns a new message object if anything was replaced, otherwise the original.
 */
function compressMessage(msg: any): any {
    try {
        const compressed = replaceBigStrings(msg);
        // Quick identity check – if nothing was stored, skip
        return compressed;
    } catch {
        return msg;
    }
}

/**
 * Compress an array of messages, skipping the last `skipTail` messages.
 * Returns a new array with compressed copies; originals are untouched.
 */
function compressMessages(messages: any[], skipTail: number = 0): { messages: any[]; replaced: number } {
    const end = messages.length - skipTail;
    let replaced = 0;
    const result = new Array(messages.length);
    const storeSizeBefore = bigStringStore.size;

    for (let i = 0; i < messages.length; i++) {
        if (i < end) {
            result[i] = compressMessage(messages[i]);
        } else {
            result[i] = messages[i];
        }
    }

    replaced = bigStringStore.size - storeSizeBefore;
    return { messages: result, replaced };
}

/**
 * The index of the last message in conversationHistory that has already
 * been compressed in-place. We only process new messages each time.
 */
let compressedUpToIndex = 0;

/**
 * Compress big strings in conversation history **in-place**.
 * Called once at the start of sendMessage() to shrink messages from
 * previous rounds before they are sent to generateText().
 */
function compressHistoryMessages(): void {
    const end = conversationHistory.length;
    if (compressedUpToIndex >= end) return;

    let replacedCount = 0;
    for (let i = compressedUpToIndex; i < end; i++) {
        const storeBefore = bigStringStore.size;
        conversationHistory[i] = compressMessage(conversationHistory[i]);
        if (bigStringStore.size > storeBefore) replacedCount++;
    }

    compressedUpToIndex = end;
    if (replacedCount > 0) {
        console.log(`[Agent] Compressed ${replacedCount} history messages (bigStringStore size: ${bigStringStore.size})`);
    }
}

// ============================================================
// Token estimation helpers
// ============================================================

/**
 * Estimate the token count for a messages array by serializing to JSON
 * and dividing by CHARS_PER_TOKEN.
 */
function estimateTokens(messages: any[]): number {
    let totalChars = 0;
    for (const msg of messages) {
        totalChars += JSON.stringify(msg).length;
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

// ============================================================
// History summarization
// ============================================================

/**
 * Summarize an array of messages into a short paragraph using the LLM.
 * Returns a summary string, or null if summarization fails.
 */
async function summarizeMessages(messages: any[]): Promise<string | null> {
    if (!isConfigured || !currentConfig.apiKey) return null;

    try {
        const provider = createOpenAI({
            apiKey: currentConfig.apiKey,
            baseURL: currentConfig.baseURL,
        });

        const modelId = currentConfig.summaryModel || currentConfig.model || 'gpt-4o-mini';
        const model = provider.chat(modelId);

        // Build a simplified text representation of the messages to summarize
        let conversationText = '';
        for (const msg of messages) {
            const role = (msg as any).role || 'unknown';
            let text = '';
            const content = (msg as any).content;
            if (typeof content === 'string') {
                text = content;
            } else if (Array.isArray(content)) {
                // Extract text parts only
                for (const part of content) {
                    if (typeof part === 'string') {
                        text += part + '\n';
                    } else if (part?.type === 'text' && part.text) {
                        text += part.text + '\n';
                    } else if (part?.type === 'tool-call') {
                        text += `[Tool call: ${part.toolName}]\n`;
                    } else if (part?.type === 'tool-result') {
                        text += `[Tool result: ${part.toolName}]\n`;
                    }
                }
            }
            // Truncate extremely long individual messages
            if (text.length > 1000) {
                text = text.substring(0, 1000) + '... (truncated)';
            }
            conversationText += `[${role}]: ${text}\n`;
        }

        // Limit total input to the summarizer
        if (conversationText.length > 20000) {
            conversationText = conversationText.substring(0, 20000) + '\n... (further content omitted)';
        }

        const result = await generateText({
            model,
            system: 'You are a concise summarizer. Summarize the following conversation history into a brief paragraph. ' +
                     'Focus on: what the user wanted to accomplish, what actions were taken (tools called, code executed), ' +
                     'key results or errors encountered, and the current state. ' +
                     `Keep the summary under ${SUMMARY_MAX_CHARS} characters. Do NOT include code blocks. ` +
                     'Write in the same language the user used.',
            prompt: conversationText,
            maxRetries: 1,
        });

        const summary = result.text?.trim();
        if (summary && summary.length > 0) {
            console.log(`[Agent] Generated history summary (${summary.length} chars)`);
            return summary;
        }
    } catch (err: any) {
        console.error(`[Agent] Failed to generate summary: ${err.message || err}`);
    }
    return null;
}

// ============================================================
// Sliding window with summarization
// ============================================================

/**
 * Trim a messages array so that the estimated token count is within budget.
 * Removed messages are optionally summarized.
 *
 * @param messages    The full messages array
 * @param tokenBudget Maximum tokens allowed
 * @param doSummarize Whether to call the LLM to summarize trimmed messages
 * @returns The trimmed messages array (may include a summary message at the start)
 */
async function trimMessagesByTokenBudget(
    messages: any[],
    tokenBudget: number,
    doSummarize: boolean = true,
): Promise<{ messages: any[]; trimmed: boolean }> {
    const estimated = estimateTokens(messages);
    if (estimated <= tokenBudget) {
        return { messages, trimmed: false };
    }

    console.log(`[Agent] Token estimate ${estimated} exceeds budget ${tokenBudget}, trimming...`);

    // Binary-ish search: find the minimum number of messages to keep from the end
    // such that the estimated tokens are within budget.
    // Always keep at least MIN_KEEP_MESSAGES.
    let keepFromEnd = Math.min(MIN_KEEP_MESSAGES, messages.length);
    const targetTokens = tokenBudget * 0.8; // trim aggressively to 80% to avoid repeated trims

    // Start from keeping MIN_KEEP_MESSAGES and increase if still within budget
    while (keepFromEnd < messages.length) {
        const candidate = messages.slice(messages.length - keepFromEnd);
        if (estimateTokens(candidate) > targetTokens) {
            // Even this many is too much, keep previous amount
            keepFromEnd = Math.max(keepFromEnd - 1, MIN_KEEP_MESSAGES);
            break;
        }
        keepFromEnd++;
    }

    const keptMessages = messages.slice(messages.length - keepFromEnd);
    const removedMessages = messages.slice(0, messages.length - keepFromEnd);

    console.log(`[Agent] Trimming: removing ${removedMessages.length} messages, keeping ${keptMessages.length}`);

    // Summarize removed messages
    let summaryMsg: any | null = null;
    if (doSummarize && removedMessages.length > 0) {
        const previousSummary = historySummary;
        const toSummarize = previousSummary
            ? [{ role: 'user', content: `[Previous summary]: ${previousSummary}` }, ...removedMessages]
            : removedMessages;

        const summary = await summarizeMessages(toSummarize);
        if (summary) {
            historySummary = summary;
            summaryMsg = {
                role: 'user' as const,
                content: `[Context Summary - the following is a summary of earlier conversation that was trimmed to save context space]:\n${summary}`,
            };
        }
    }

    const result = summaryMsg ? [summaryMsg, ...keptMessages] : keptMessages;
    return { messages: result, trimmed: true };
}

// ============================================================
// retrieveBigString tool
// ============================================================

function createRetrieveBigStringTool() {
    return {
        retrieveBigString: tool({
            description:
                'Retrieve the original content of a compressed placeholder. ' +
                'In conversation history, large strings are automatically replaced with ' +
                'placeholders to save context space. ' +
                'Call this tool with the index from the placeholder to get the full original text. ' +
                'Note: image placeholders CANNOT be retrieved — take a new screenshot instead.',
            inputSchema: z.object({
                index: z
                    .number()
                    .int()
                    .min(0)
                    .describe('The index from the placeholder, e.g. for bigstr_xxxxx(3, 1200, "code"), index is 3.'),
            }),
            execute: async ({ index }) => {
                const result = bigStringStore.retrieve(index);
                if (!result) {
                    const meta = bigStringStore.getMeta(index);
                    if (meta?.nonRetrievable) {
                        return {
                            success: false,
                            error: `Entry ${index} is a non-retrievable ${meta.contentType} (${meta.length} chars). If it's an image, take a new screenshot instead.`,
                        };
                    }
                    return {
                        success: false,
                        error: `No entry found at index ${index}. Valid range: 0-${bigStringStore.size - 1}.`,
                    };
                }
                return {
                    success: true,
                    contentType: result.contentType,
                    content: result.content,
                };
            },
        }),
    };
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

/**
 * Build the effective system prompt, injecting the current placeholder prefixes.
 */
function buildSystemPrompt(): string {
    return SYSTEM_PROMPT
        .replace(/\{BIGSTR_PREFIX\}/g, bigStringStore.prefix)
        .replace(/\{IMAGE_PREFIX\}/g, bigStringStore.imagePrefix);
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
export async function sendMessage(userMessage: string, imageBase64?: string, imageMimeType?: string): Promise<string> {
    if (!isConfigured || !currentConfig.apiKey) {
        return '[Agent] Not configured. Please set API key first via the Settings panel.';
    }

    // ---- Compress big strings in PREVIOUS history before adding new message ----
    compressHistoryMessages();

    // ---- Sliding window: trim conversationHistory if too long (cross-round) ----
    if (ENABLE_SLIDING_WINDOW) {
        const estimated = estimateTokens(conversationHistory);
        if (estimated > MAX_INPUT_TOKENS) {
            const { messages: trimmed, trimmed: didTrim } = await trimMessagesByTokenBudget(
                conversationHistory, MAX_INPUT_TOKENS, /* doSummarize */ true
            );
            if (didTrim) {
                conversationHistory = trimmed as ModelMessage[];
                compressedUpToIndex = conversationHistory.length; // already compressed
            }
        }
    }

    // Add user message to history (with optional image)
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

    try {
        const provider = createOpenAI({
            apiKey: currentConfig.apiKey,
            baseURL: currentConfig.baseURL,
        });

        // Use provider.chat() to force Chat Completions API format.
        // In @ai-sdk/openai v3, provider() defaults to the Responses API
        // which uses a different request format (input/input_text) that
        // most third-party proxy endpoints do not support.
        const model = provider.chat(currentConfig.model || 'gpt-4o-mini');

        // Create tools for the agent
        const tools = {
            ...createUnityLogTools(),
            ...createScreenshotTools(),
            ...createTypeReflectionTools(),
            ...createEvalTools(),
            ...createRetrieveBigStringTool(),
        };

        const result = await generateText({
            model,
            system: buildSystemPrompt(),
            messages: conversationHistory,
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
            prepareStep({ messages, stepNumber, steps }) {
                if (stepNumber === 0) return undefined;

                // ---- (1) Compress big strings in OLDER messages ----
                // Skip the last 2 messages (the assistant tool-call + tool result
                // from the most recent step) so the model can see the fresh result.
                const { messages: compressed, replaced } = compressMessages(messages, 2);
                let newMessages = replaced > 0 ? compressed : [...messages];
                if (replaced > 0) {
                    console.log(`[Agent] prepareStep(${stepNumber}): compressed ${replaced} big strings (store size: ${bigStringStore.size})`);
                }

                // ---- (1.5) Sliding window: check actual token usage from last step ----
                if (!ENABLE_SLIDING_WINDOW) {
                    // Sliding window disabled -- skip token checks and trimming.
                } else {
                // Use the real inputTokens from the previous step if available.
                const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
                const lastInputTokens = lastStep?.usage?.inputTokens;
                if (lastInputTokens && lastInputTokens > MAX_INPUT_TOKENS) {
                    console.log(`[Agent] prepareStep(${stepNumber}): last step used ${lastInputTokens} input tokens, exceeds ${MAX_INPUT_TOKENS}, trimming...`);
                    // Synchronous trim without summarization (we're inside prepareStep,
                    // can't easily await an LLM call without blocking the step loop).
                    // Keep MIN_KEEP_MESSAGES from the end.
                    const keep = Math.min(MIN_KEEP_MESSAGES, newMessages.length);
                    const trimmedMsgs = newMessages.slice(newMessages.length - keep);

                    // Prepend existing summary if available
                    if (historySummary) {
                        trimmedMsgs.unshift({
                            role: 'user' as const,
                            content: `[Context Summary - the following is a summary of earlier conversation that was trimmed to save context space]:\n${historySummary}`,
                        } as any);
                    }
                    newMessages = trimmedMsgs;
                    console.log(`[Agent] prepareStep(${stepNumber}): trimmed to ${newMessages.length} messages`);
                } else {
                    // Fallback: estimate from serialized size
                    const estimatedTokens = estimateTokens(newMessages);
                    if (estimatedTokens > MAX_INPUT_TOKENS) {
                        console.log(`[Agent] prepareStep(${stepNumber}): estimated ${estimatedTokens} tokens, exceeds ${MAX_INPUT_TOKENS}, trimming...`);
                        const keep = Math.min(MIN_KEEP_MESSAGES, newMessages.length);
                        const trimmedMsgs = newMessages.slice(newMessages.length - keep);
                        if (historySummary) {
                            trimmedMsgs.unshift({
                                role: 'user' as const,
                                content: `[Context Summary - the following is a summary of earlier conversation that was trimmed to save context space]:\n${historySummary}`,
                            } as any);
                        }
                        newMessages = trimmedMsgs;
                        console.log(`[Agent] prepareStep(${stepNumber}): trimmed to ${newMessages.length} messages`);
                    }
                }
                } // end ENABLE_SLIDING_WINDOW

                // ---- (2) Extract screenshot images from the last tool message ----
                // The Chat Completions API converter JSON.stringifies content-type
                // tool outputs (including file-data images), so the model cannot
                // "see" them. We extract such images and append a user message
                // with proper image parts that the converter handles correctly.
                const lastMsg = newMessages[newMessages.length - 1];
                if (!lastMsg || lastMsg.role !== 'tool') {
                    return replaced > 0 ? { messages: newMessages } : undefined;
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
                            // Replace content output with text-only version
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
                    // Replace the tool message with patched (image-stripped) version
                    newMessages[newMessages.length - 1] = {
                        role: 'tool',
                        content: patchedContent,
                    } as any;
                    // Append user message with the extracted images
                    newMessages.push({
                        role: 'user',
                        content: [
                            ...imageParts,
                            {
                                type: 'text' as const,
                                text: 'Above is the screenshot I just captured. Please analyze it and respond to my earlier request.',
                            },
                        ],
                    } as any);
                }

                return { messages: newMessages };
            },
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
        const errorMsg = `[Agent] Error: ${error.message || String(error)}`;
        console.error(errorMsg);

        // Remove the failed user message from history
        conversationHistory.pop();

        return errorMsg;
    }
}

/**
 * Continue generation after the step limit was reached.
 * Re-invokes generateText with the existing conversationHistory (which already
 * contains all previous assistant + tool messages) so the agent picks up
 * where it left off.
 */
export async function continueGeneration(): Promise<string> {
    if (!isConfigured || !currentConfig.apiKey) {
        return '[Agent] Not configured. Please set API key first via the Settings panel.';
    }

    console.log('[Agent] Continuing generation from where it left off...');

    // Compress history before continuing
    compressHistoryMessages();

    // Sliding window trim if needed
    if (ENABLE_SLIDING_WINDOW) {
        const estimated = estimateTokens(conversationHistory);
        if (estimated > MAX_INPUT_TOKENS) {
            const { messages: trimmed, trimmed: didTrim } = await trimMessagesByTokenBudget(
                conversationHistory, MAX_INPUT_TOKENS, true
            );
            if (didTrim) {
                conversationHistory = trimmed as ModelMessage[];
                compressedUpToIndex = conversationHistory.length;
            }
        }
    }

    // Add a brief user message to prompt the model to continue
    conversationHistory.push({
        role: 'user',
        content: 'Please continue. Pick up from where you left off and keep working on the task.',
    });

    try {
        const provider = createOpenAI({
            apiKey: currentConfig.apiKey,
            baseURL: currentConfig.baseURL,
        });
        const model = provider.chat(currentConfig.model || 'gpt-4o-mini');
        const tools = {
            ...createUnityLogTools(),
            ...createScreenshotTools(),
            ...createTypeReflectionTools(),
            ...createEvalTools(),
            ...createRetrieveBigStringTool(),
        };

        const result = await generateText({
            model,
            system: buildSystemPrompt(),
            messages: conversationHistory,
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
            prepareStep({ messages, stepNumber, steps }) {
                if (stepNumber === 0) return undefined;

                const { messages: compressed, replaced } = compressMessages(messages, 2);
                let newMessages = replaced > 0 ? compressed : [...messages];
                if (replaced > 0) {
                    console.log(`[Agent] continueGeneration prepareStep(${stepNumber}): compressed ${replaced} big strings`);
                }

                if (ENABLE_SLIDING_WINDOW) {
                    const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
                    const lastInputTokens = lastStep?.usage?.inputTokens;
                    if (lastInputTokens && lastInputTokens > MAX_INPUT_TOKENS) {
                        const keep = Math.min(MIN_KEEP_MESSAGES, newMessages.length);
                        const trimmedMsgs = newMessages.slice(newMessages.length - keep);
                        if (historySummary) {
                            trimmedMsgs.unshift({
                                role: 'user' as const,
                                content: `[Context Summary]:\n${historySummary}`,
                            } as any);
                        }
                        newMessages = trimmedMsgs;
                    } else {
                        const estimatedTokens = estimateTokens(newMessages);
                        if (estimatedTokens > MAX_INPUT_TOKENS) {
                            const keep = Math.min(MIN_KEEP_MESSAGES, newMessages.length);
                            const trimmedMsgs = newMessages.slice(newMessages.length - keep);
                            if (historySummary) {
                                trimmedMsgs.unshift({
                                    role: 'user' as const,
                                    content: `[Context Summary]:\n${historySummary}`,
                                } as any);
                            }
                            newMessages = trimmedMsgs;
                        }
                    }
                }

                // Screenshot image extraction (same logic as sendMessage)
                const lastMsg = newMessages[newMessages.length - 1];
                if (!lastMsg || lastMsg.role !== 'tool') {
                    return replaced > 0 ? { messages: newMessages } : undefined;
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
                    newMessages[newMessages.length - 1] = { role: 'tool', content: patchedContent } as any;
                    newMessages.push({
                        role: 'user',
                        content: [
                            ...imageParts,
                            { type: 'text' as const, text: 'Above is the screenshot I just captured. Please analyze it and respond to my earlier request.' },
                        ],
                    } as any);
                }

                return { messages: newMessages };
            },
        });

        for (const msg of result.response.messages) {
            conversationHistory.push(msg as ModelMessage);
        }

        if (result.steps.length >= MAX_STEPS) {
            const partialText = result.text || '';
            console.log(`[Agent] Reached max steps again (${MAX_STEPS}). Pausing for user confirmation.`);
            return `${STEP_LIMIT_PREFIX}${partialText}`;
        }

        return result.text;
    } catch (error: any) {
        const errorMsg = `[Agent] Error: ${error.message || String(error)}`;
        console.error(errorMsg);
        // Remove the "continue" user message on failure
        conversationHistory.pop();
        return errorMsg;
    }
}

/**
 * Clear conversation history.
 */
export function clearHistory(): void {
    conversationHistory = [];
    compressedUpToIndex = 0;
    bigStringStore.clear();
    historySummary = null;
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
