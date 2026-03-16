/**
 * Agent Core Module
 * Uses Vercel AI SDK to interact with LLM APIs.
 */
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { tool } from 'ai';
import { z } from 'zod';

import { createScreenshotTools } from '../tools/screenshot-tool.mjs';
import { createEvalTools } from '../tools/eval-tool.mjs';

// ============================================================
// ImageStore – stores compressed base64 image data with retrievable placeholders
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

/** Metadata about a stored image entry. */
interface ImageEntry {
    content: string;
    length: number;
}

class ImageStore {
    private entries: ImageEntry[] = [];
    /** Unique prefix for image placeholders, e.g. "image_a3f9x". */
    readonly imagePrefix: string;

    constructor() {
        const suffix = randomSuffix(5);
        this.imagePrefix = `image_${suffix}`;
    }

    /** Store an image string and return its index. */
    store(content: string): number {
        const index = this.entries.length;
        this.entries.push({ content, length: content.length });
        return index;
    }

    /** Build a placeholder string for a stored entry. */
    placeholder(index: number, length: number): string {
        return `${this.imagePrefix}(${index}, ${length})`;
    }

    /** Retrieve a stored image string by index. Returns null if not found. */
    retrieve(index: number): string | null {
        if (index < 0 || index >= this.entries.length) return null;
        return this.entries[index].content;
    }

    /** Clear all stored entries and regenerate prefix. */
    clear(): void {
        this.entries = [];
        const suffix = randomSuffix(5);
        (this as any).imagePrefix = `image_${suffix}`;
    }

    get size(): number {
        return this.entries.length;
    }
}

let imageStore = new ImageStore();

/**
 * AbortController for the current generation.
 * Created at the start of each runGeneration() call;
 * calling abortGeneration() triggers the signal so
 * generateText stops as soon as possible.
 */
let currentAbortController: AbortController | null = null;

/**
 * Minimum string length to trigger image base64 replacement with a placeholder.
 */
const IMAGE_COMPRESS_THRESHOLD = 500;

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
 * Character budget for the compaction summary.
 * Increased to preserve more structured context.
 */
const SUMMARY_MAX_CHARS = 4000;

/**
 * Minimum token savings required before actually pruning tool outputs.
 * Avoids pruning when the savings would be negligible.
 */
const PRUNE_MINIMUM = 20_000;

/**
 * Token budget of recent tool outputs to protect from pruning.
 * Tool results within this budget (counting from the most recent) are kept intact.
 */
const PRUNE_PROTECT = 40_000;

// Agent configuration interface
export interface AgentConfig {
    apiKey: string;
    baseURL?: string;
    model?: string;
    /** Optional: a cheaper / faster model ID used for summarizing trimmed history.
     *  If not set, the main model is used. */
    summaryModel?: string;
}

//TDOO: System prompt add unity version and puerTs version
/** System prompt is managed entirely by the TS side and cannot be overridden from C#. */
const SYSTEM_PROMPT = `You are a helpful AI assistant running inside Unity via PuerTS (a TypeScript/JavaScript runtime for Unity). You can help with game development, scripting, and general questions. Be concise and practical.

## Context Compression — Image Placeholders

To save context space, base64-encoded image data in **past** tool call results
is automatically replaced with compact placeholders.
The placeholder prefix is unique per session:

- \`{IMAGE_PREFIX}(index, length)\` - a base64-encoded image that was replaced.
  \`index\` is the storage slot, \`length\` is the original character count.
  **You can retrieve the original content** by calling the \`retrieveImage\` tool with the index.
  Only retrieve it when you genuinely need the exact base64 data — in most cases,
  take a new screenshot via \`captureScreenshot\` instead.

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

## evalJsCode Runtime Environment

The evalJsCode tool runs in a **pure V8 engine** — there is NO \`window\`, \`document\`, \`DOM\`, or any browser/Node.js API. However, \`setTimeout\`, \`setInterval\`, \`clearTimeout\`, and \`clearInterval\` are available (provided by PuerTS). To persist state across calls, use \`globalThis.myVar = ...\` or top-level \`var\` declarations.

## Unity Edit Mode Detection

Before using runtime-only APIs (e.g. \`Destroy\`, \`MeshFilter.mesh\`, coroutines), first check \`CS.UnityEngine.Application.isPlaying\` via \`evalJsCode\` and use edit-mode-safe alternatives when needed (e.g. \`DestroyImmediate\`, \`sharedMesh\`).
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
// History compression – replace image base64 data with placeholders
// ============================================================

/** Check if a key indicates image base64 content. */
function isImageBase64Key(key: string): boolean {
    return key === 'data' || key === 'base64' || key === 'image';
}

/**
 * Recursively walk a JSON-like value and replace large base64 image strings
 * with placeholders **in-place**. Arrays and objects are mutated directly
 * so that the AI SDK's internal message references are updated, preventing
 * the same image from being stored multiple times across steps.
 * Returns true if any replacement was made.
 */
function replaceImageStringsInPlace(obj: any, parentKey: string = ''): boolean {
    if (obj === null || obj === undefined) return false;
    // Strings cannot be mutated in-place; the caller handles replacement.
    // We only recurse into arrays and objects here.

    if (Array.isArray(obj)) {
        let changed = false;
        for (let i = 0; i < obj.length; i++) {
            const item = obj[i];
            if (typeof item === 'string') {
                if (item.length >= IMAGE_COMPRESS_THRESHOLD && isImageBase64Key(parentKey)) {
                    const idx = imageStore.store(item);
                    obj[i] = imageStore.placeholder(idx, item.length);
                    changed = true;
                }
            } else {
                if (replaceImageStringsInPlace(item, parentKey)) changed = true;
            }
        }
        return changed;
    }

    if (typeof obj === 'object') {
        // Skip AI SDK image content parts ({ type: 'image', image: <base64> }).
        // These are sent directly via the API's image_url mechanism and must
        // remain valid base64.  They will be handled separately by
        // stripOldUserImages() which removes them from older user messages.
        if (obj.type === 'image' && typeof obj.image === 'string') {
            return false;
        }

        let changed = false;
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'string') {
                if (val.length >= IMAGE_COMPRESS_THRESHOLD && isImageBase64Key(key)) {
                    const idx = imageStore.store(val);
                    obj[key] = imageStore.placeholder(idx, val.length);
                    changed = true;
                }
            } else {
                if (replaceImageStringsInPlace(val, key)) changed = true;
            }
        }
        return changed;
    }

    return false;
}

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
        const storeBefore = imageStore.size;
        if (imageStore.size > storeBefore) replacedCount++;
    }

    compressedUpToIndex = end;
    if (replacedCount > 0) {
        console.log(`[Agent] Compressed ${replacedCount} image(s) in history (imageStore size: ${imageStore.size})`);
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
// Prune old tool outputs (inspired by opencode's prune mechanism)
// ============================================================

/**
 * Estimate the token count for a single value by JSON-serializing it.
 */
function estimateTokensSingle(value: unknown): number {
    try {
        return Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);
    } catch {
        return 0;
    }
}

/**
 * Walk backwards through messages and replace old tool-call outputs with
 * a short placeholder. The most recent tool outputs (within PRUNE_PROTECT
 * budget) are kept intact. Only outputs older than that are pruned.
 *
 * This dramatically reduces token usage before compaction runs, while
 * preserving recent tool context the model likely still needs.
 *
 * @returns The number of tokens reclaimed by pruning.
 */
function pruneOldToolOutputs(messages: any[]): number {
    let total = 0;
    let pruned = 0;
    const toPrune: Array<{ msg: any; partIndex: number; estimate: number }> = [];

    // Walk backwards, skip the last 2 messages (current user turn + last assistant)
    for (let msgIdx = messages.length - 1; msgIdx >= 0; msgIdx--) {
        const msg = messages[msgIdx] as any;

        // For tool-role messages, each content part may be a tool-result
        if (msg.role === 'tool' && Array.isArray(msg.content)) {
            for (let partIdx = msg.content.length - 1; partIdx >= 0; partIdx--) {
                const part = msg.content[partIdx];
                if (part?.type === 'tool-result') {
                    const estimate = estimateTokensSingle(part.output);
                    total += estimate;
                    if (total > PRUNE_PROTECT) {
                        pruned += estimate;
                        toPrune.push({ msg, partIndex: partIdx, estimate });
                    }
                }
            }
        }

        // For assistant messages with tool_calls results embedded
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            for (let partIdx = msg.content.length - 1; partIdx >= 0; partIdx--) {
                const part = msg.content[partIdx];
                if (part?.type === 'tool-result') {
                    const estimate = estimateTokensSingle(part.output);
                    total += estimate;
                    if (total > PRUNE_PROTECT) {
                        pruned += estimate;
                        toPrune.push({ msg, partIndex: partIdx, estimate });
                    }
                }
            }
        }
    }

    if (pruned < PRUNE_MINIMUM) {
        return 0; // Not enough savings to bother
    }

    // Actually prune
    for (const { msg, partIndex } of toPrune) {
        const part = msg.content[partIndex];
        const toolName = part.toolName || 'unknown';
        part.output = { type: 'text' as const, value: `[output pruned — tool: ${toolName}]` };
    }

    console.log(`[Agent] Pruned ${toPrune.length} old tool output(s), reclaimed ~${pruned} tokens`);
    return pruned;
}

// ============================================================
// Context compaction (structured summarization)
// ============================================================

/** The structured prompt template for compaction, adapted for Unity dev context. */
const COMPACTION_PROMPT = `Provide a detailed summary for continuing our conversation.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files/GameObjects we're working on, and what we're going to do next.
The summary will be used so that another agent can read it and continue the work seamlessly.

When constructing the summary, follow this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give that are relevant]
- [If there is a plan or spec, include information about it]

## Discoveries

[What notable things were learned during this conversation — e.g. scene hierarchy, component states, API behaviors, errors encountered and their fixes]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant Context

[List relevant GameObjects, scripts, scenes, assets, tool outputs, or code snippets that pertain to the task. Include specific names and paths.]
---

Keep the summary under ${SUMMARY_MAX_CHARS} characters. Write in the same language the user used.`;

/**
 * Build a text representation of messages for the compaction model.
 * Strips images but preserves tool call names and text content.
 */
function buildCompactionInput(messages: any[]): string {
    let text = '';
    for (const msg of messages) {
        const role = (msg as any).role || 'unknown';
        let msgText = '';
        const content = (msg as any).content;
        if (typeof content === 'string') {
            msgText = content;
        } else if (Array.isArray(content)) {
            for (const part of content) {
                if (typeof part === 'string') {
                    msgText += part + '\n';
                } else if (part?.type === 'text' && part.text) {
                    msgText += part.text + '\n';
                } else if (part?.type === 'tool-call') {
                    msgText += `[Tool call: ${part.toolName}(${JSON.stringify(part.args || {}).substring(0, 200)})]\n`;
                } else if (part?.type === 'tool-result') {
                    const output = typeof part.output === 'string'
                        ? part.output
                        : JSON.stringify(part.output || '');
                    const truncOutput = output.length > 500 ? output.substring(0, 500) + '...' : output;
                    msgText += `[Tool result: ${part.toolName} → ${truncOutput}]\n`;
                }
            }
        }
        // Truncate extremely long individual messages
        if (msgText.length > 2000) {
            msgText = msgText.substring(0, 2000) + '... (truncated)';
        }
        text += `[${role}]: ${msgText}\n`;
    }

    // Limit total input to the compaction model
    if (text.length > 40000) {
        text = text.substring(0, 40000) + '\n... (further content omitted)';
    }
    return text;
}

/**
 * Generate a structured compaction summary from an array of messages.
 * Uses the compaction prompt template inspired by opencode.
 * Returns the summary string, or null if compaction fails.
 */
async function compactMessages(messages: any[]): Promise<string | null> {
    if (!isConfigured || !currentConfig.apiKey) return null;

    try {
        const provider = createOpenAI({
            apiKey: currentConfig.apiKey,
            baseURL: currentConfig.baseURL,
        });

        const modelId = currentConfig.summaryModel || currentConfig.model || 'gpt-4o-mini';
        const model = provider.chat(modelId);

        const conversationText = buildCompactionInput(messages);

        const result = await generateText({
            model,
            system: COMPACTION_PROMPT,
            prompt: conversationText,
            maxRetries: 1,
        });

        const summary = result.text?.trim();
        if (summary && summary.length > 0) {
            console.log(`[Agent] Generated compaction summary (${summary.length} chars)`);
            return summary;
        }
    } catch (err: any) {
        console.error(`[Agent] Failed to generate compaction summary: ${err.message || err}`);
    }
    return null;
}

// ============================================================
// Sliding window with prune + compaction
// ============================================================

/**
 * Trim a messages array so that the estimated token count is within budget.
 * Uses a two-phase approach inspired by opencode:
 *
 * Phase 1 — **Prune**: Walk backwards and replace old tool-call outputs
 *   with short placeholders, keeping only the most recent tool results intact.
 *   This alone often frees enough tokens.
 *
 * Phase 2 — **Compact**: If still over budget after pruning, remove older
 *   messages and generate a structured compaction summary via the LLM.
 *
 * @param messages    The full messages array (mutated in-place for pruning)
 * @param tokenBudget Maximum tokens allowed
 * @returns The trimmed messages array (may include a compaction summary at the start)
 */
async function trimMessagesByTokenBudget(
    messages: any[],
    tokenBudget: number,
): Promise<{ messages: any[]; trimmed: boolean }> {
    let estimated = estimateTokens(messages);
    if (estimated <= tokenBudget) {
        return { messages, trimmed: false };
    }

    console.log(`[Agent] Token estimate ${estimated} exceeds budget ${tokenBudget}`);

    // ---- Phase 1: Prune old tool outputs in-place ----
    const prunedTokens = pruneOldToolOutputs(messages);
    if (prunedTokens > 0) {
        estimated = estimateTokens(messages);
        console.log(`[Agent] After pruning: ~${estimated} tokens`);
        if (estimated <= tokenBudget) {
            return { messages, trimmed: true };
        }
    }

    // ---- Phase 2: Compact — remove old messages + structured summary ----
    console.log(`[Agent] Still over budget after pruning, running compaction...`);

    // Find how many messages to keep from the end
    let keepFromEnd = Math.min(MIN_KEEP_MESSAGES, messages.length);
    const targetTokens = tokenBudget * 0.75; // trim to 75% to leave room for the summary

    while (keepFromEnd < messages.length) {
        const candidate = messages.slice(messages.length - keepFromEnd);
        if (estimateTokens(candidate) > targetTokens) {
            keepFromEnd = Math.max(keepFromEnd - 1, MIN_KEEP_MESSAGES);
            break;
        }
        keepFromEnd++;
    }

    const keptMessages = messages.slice(messages.length - keepFromEnd);
    const removedMessages = messages.slice(0, messages.length - keepFromEnd);

    console.log(`[Agent] Compaction: removing ${removedMessages.length} messages, keeping ${keptMessages.length}`);

    // Build input for compaction, including any previous summary
    let summaryMsg: any | null = null;
    if (removedMessages.length > 0) {
        const toCompact = historySummary
            ? [{ role: 'user', content: `[Previous compaction summary]:\n${historySummary}` }, ...removedMessages]
            : removedMessages;

        const summary = await compactMessages(toCompact);
        if (summary) {
            historySummary = summary;
            summaryMsg = {
                role: 'user' as const,
                content: `[Compacted Context — this is a structured summary of earlier conversation that was compacted to save context space]:\n${summary}`,
            };
        }
    }

    const result = summaryMsg ? [summaryMsg, ...keptMessages] : keptMessages;
    return { messages: result, trimmed: true };
}

// ============================================================
// retrieveImage tool
// ============================================================

function createRetrieveImageTool() {
    return {
        retrieveImage: tool({
            description:
                'Retrieve the original base64 content of a compressed image placeholder. ' +
                'In conversation history, base64-encoded image data is automatically replaced with ' +
                'compact placeholders to save context space. ' +
                'Call this tool with the index from the placeholder to get the full base64 string.',
            inputSchema: z.object({
                index: z
                    .number()
                    .int()
                    .min(0)
                    .describe('The index from the placeholder, e.g. for image_xxxxx(3, 1200), index is 3.'),
            }),
            execute: async ({ index }) => {
                const content = imageStore.retrieve(index);
                if (content === null) {
                    return {
                        success: false,
                        error: `No entry found at index ${index}. Valid range: 0-${imageStore.size - 1}.`,
                    };
                }
                return {
                    success: true,
                    content,
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
        .replace(/\{IMAGE_PREFIX\}/g, imageStore.imagePrefix);
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

    // ---- (1.5) Sliding window: check actual token usage from last step ----
    if (ENABLE_SLIDING_WINDOW) {
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
                if (historySummary) {
                    trimmedMsgs.unshift({
                        role: 'user' as const,
                        content: `[Compacted Context — this is a structured summary of earlier conversation that was compacted to save context space]:\n${historySummary}`,
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
 * Strip image parts from older user messages in conversationHistory.
 * The most recent user message with images is preserved (it may be
 * the current turn or a very recent reference).  Older ones have their
 * `{ type: 'image' }` content parts replaced with a text note so the
 * API doesn't receive stale (and large) base64 data.
 */
function stripOldUserImages(): void {
    // Find all user-message indices that contain image parts
    const indicesWithImages: number[] = [];
    for (let i = 0; i < conversationHistory.length; i++) {
        const msg = conversationHistory[i] as any;
        if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
        if (msg.content.some((p: any) => p.type === 'image')) {
            indicesWithImages.push(i);
        }
    }

    // Keep the latest one intact, strip images from the rest
    if (indicesWithImages.length <= 1) return;

    const toStrip = indicesWithImages.slice(0, -1);
    for (const idx of toStrip) {
        const msg = conversationHistory[idx] as any;
        let strippedCount = 0;
        msg.content = msg.content.map((part: any) => {
            if (part.type === 'image' && typeof part.image === 'string') {
                strippedCount++;
                // Store the base64 data into imageStore so AI can retrieve it via retrieveImage tool
                const base64Data = part.image;
                const storeIdx = imageStore.store(base64Data);
                const placeholder = imageStore.placeholder(storeIdx, base64Data.length);
                return {
                    type: 'text' as const,
                    text: `[User-attached image was removed to save context space. Placeholder: ${placeholder} – use retrieveImage tool with index ${storeIdx} if you need to see it again.]`,
                };
            }
            return part;
        });
        if (strippedCount > 0) {
            console.log(`[Agent] Stripped ${strippedCount} image(s) from older user message at index ${idx}, stored in imageStore`);
        }
    }
}

/**
 * Compress history and apply sliding-window trimming.
 * Shared pre-processing for both sendMessage and continueGeneration.
 */
async function prepareHistory(): Promise<void> {
    stripOldUserImages();
    compressHistoryMessages();

    if (ENABLE_SLIDING_WINDOW) {
        const estimated = estimateTokens(conversationHistory);
        if (estimated > MAX_INPUT_TOKENS) {
            const { messages: trimmed, trimmed: didTrim } = await trimMessagesByTokenBudget(
                conversationHistory, MAX_INPUT_TOKENS
            );
            if (didTrim) {
                conversationHistory = trimmed as ModelMessage[];
                compressedUpToIndex = conversationHistory.length;
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
            system: buildSystemPrompt(),
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

    // Compress & trim history
    await prepareHistory();

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

    // Compress & trim history
    await prepareHistory();

    // Add a brief user message to prompt the model to continue
    conversationHistory.push({
        role: 'user',
        content: 'Please continue. Pick up from where you left off and keep working on the task.',
    });

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
    compressedUpToIndex = 0;
    imageStore.clear();
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
