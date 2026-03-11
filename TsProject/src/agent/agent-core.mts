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
- If a delegate has value-type parameters, you need to add \`UsingAction\` or \`UsingFunc\` declarations (see PuerTS FAQ).
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
 * We implement a manual tool-call loop instead of relying on maxSteps,
 * because the OpenAI provider's convertToOpenAIChatMessages does NOT
 * support images inside tool-result messages. By handling the loop
 * ourselves, we can inject screenshot images as user-message image parts
 * (which the provider correctly converts to image_url).
 */
export async function sendMessage(userMessage: string, imageBase64?: string, imageMimeType?: string): Promise<string> {
    if (!isConfigured || !currentConfig.apiKey) {
        return '[Agent] Not configured. Please set API key first via the Settings panel.';
    }

    // Add user message to history (with optional image)
    if (imageBase64 && imageMimeType) {
        console.log(`[Agent] Message includes attached image (${imageMimeType}, ${imageBase64.length} base64 chars)`);
        // Pass raw base64 string + mediaType so the AI SDK treats it as inline
        // data content.  The OpenAI provider will emit:
        // { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
        // NOTE: Do NOT wrap in `new URL("data:...")` – the SDK's downloadAssets
        // would try to fetch it and validateDownloadUrl rejects data: URLs.
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

        const MAX_STEPS = 25;

        for (let step = 0; step < MAX_STEPS; step++) {
            const result = await generateText({
                model,
                system: currentConfig.systemPrompt,
                messages: conversationHistory,
                tools,
                stopWhen: stepCountIs(1),  // single step — we manage the loop
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
                        input: tc.input,
                    })),
                });

                // 2. Build tool-result messages, and collect any images to inject
                const toolResultParts: ModelMessage['content'] extends infer T ? T extends any[] ? T : never : never = [];
                const imageParts: Array<{ type: 'image'; image: string; mediaType: string }> = [];

                for (const tr of toolResults) {
                    const execResult = tr.output as any;

                    // For screenshot tool: extract the base64 image data
                    if (tr.toolName === 'captureScreenshot' && execResult?.success && execResult?.base64) {
                        // Store image to inject as a user message later.
                        // Pass raw base64 string so the SDK does not attempt to
                        // download a data: URL (which would fail validation).
                        imageParts.push({
                            type: 'image' as const,
                            image: execResult.base64,
                            mediaType: 'image/png',
                        } as any);

                        // Push a text-only tool result (no base64 blob to waste tokens)
                        toolResultParts.push({
                            type: 'tool-result' as const,
                            toolCallId: tr.toolCallId,
                            toolName: tr.toolName,
                            output: {
                                type: 'json' as const,
                                value: {
                                    success: true,
                                    message: execResult.message || `Screenshot captured (${execResult.width}x${execResult.height}).`,
                                    width: execResult.width,
                                    height: execResult.height,
                                },
                            },
                        } as any);
                    } else {
                        toolResultParts.push({
                            type: 'tool-result' as const,
                            toolCallId: tr.toolCallId,
                            toolName: tr.toolName,
                            output: {
                                type: 'json' as const,
                                value: execResult,
                            },
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
