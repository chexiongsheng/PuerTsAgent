/**
 * Agent Core Module
 * Uses Vercel AI SDK to interact with LLM APIs.
 */
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createUnityLogTools } from '../tools/unity-log-tool.mjs';
import { createScreenshotTools } from '../tools/screenshot-tool.mjs';
import { createTypeReflectionTools } from '../tools/type-reflection-tool.mjs';
import { createEvalTools } from '../tools/eval-tool.mjs';

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
    systemPrompt: `You are a helpful AI assistant running inside Unity via PuerTS (a TypeScript/JavaScript runtime for Unity). You can help with game development, scripting, and general questions. Be concise and practical.

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
`,
};

// Conversation history
let conversationHistory: ModelMessage[] = [];
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
 * Uses maxSteps for automatic tool-call looping. A prepareStep hook
 * intercepts screenshot images from tool results and re-injects them
 * as user-message image parts, because the Chat Completions API
 * converter only JSON.stringifies tool-result content (no image_url).
 */
export async function sendMessage(userMessage: string, imageBase64?: string, imageMimeType?: string): Promise<string> {
    if (!isConfigured || !currentConfig.apiKey) {
        return '[Agent] Not configured. Please set API key first via the Settings panel.';
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
        };

        const result = await generateText({
            model,
            system: currentConfig.systemPrompt,
            messages: conversationHistory,
            tools,
            stopWhen: stepCountIs(25),
            prepareStep({ messages, stepNumber }) {
                if (stepNumber === 0) return undefined;

                // Scan the last tool message for screenshot images.
                // The Chat Completions API converter JSON.stringifies content-type
                // tool outputs (including file-data images), so the model cannot
                // "see" them. We extract such images and append a user message
                // with proper image parts that the converter handles correctly.
                const lastMsg = messages[messages.length - 1];
                if (!lastMsg || lastMsg.role !== 'tool') return undefined;

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
                    console.log(`[Agent] prepareStep: injecting ${imageParts.length} screenshot image(s) as user message`);
                    const newMessages = [...messages];
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
                    return { messages: newMessages };
                }

                return undefined;
            },
        });

        // Append all response messages (assistant + tool) to conversation history
        for (const msg of result.response.messages) {
            conversationHistory.push(msg as ModelMessage);
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
