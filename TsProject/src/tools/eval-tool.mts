/**
 * Eval Tool for AI Agent
 * Allows the LLM to execute arbitrary JavaScript code in the PuerTS runtime.
 * Since PuerTS bridges JS and C#, the evaluated code can call Unity Engine APIs
 * via the CS global object and use PuerTS helpers (puer.$ref, puer.$generic, etc.).
 */
import { tool } from 'ai';
import { z } from 'zod';

/**
 * Create eval tools that the agent can use to execute JS code at runtime.
 */
export function createEvalTools() {
    return {
        /**
         * Evaluate JavaScript code in the PuerTS runtime environment.
         */
        evalJsCode: tool({
            description:
                'Execute JavaScript code in the PuerTS runtime environment. ' +
                'The code runs inside Unity via PuerTS, so it has full access to:\n' +
                '- The `CS` global object for calling any C# / Unity API (e.g. CS.UnityEngine.GameObject, CS.UnityEngine.Debug.Log)\n' +
                '- The `puer` global object for PuerTS helpers ($ref, $unref, $generic, $typeof, $promise)\n' +
                '- Standard JS/TS features\n\n' +
                'Use this tool when you need to:\n' +
                '- Inspect or modify Unity scene objects at runtime\n' +
                '- Create/destroy GameObjects or Components\n' +
                '- Query transform hierarchies, component states, etc.\n' +
                '- Execute any Unity API call dynamically\n' +
                '- Test code snippets in the live Unity environment\n\n' +
                'The code is evaluated via eval(). The return value of the last expression will be captured as the result. ' +
                'Use console.log() for debug output (it goes to Unity console). ' +
                'Wrap async operations with await if needed (the eval is wrapped in an async context).\n\n' +
                'IMPORTANT: Follow PuerTS interop rules. For example:\n' +
                '- Use CS.UnityEngine.Vector3.op_Addition(a, b) instead of a + b for operator overloading\n' +
                '- Use puer.$typeof(CS.SomeType) instead of typeof for C# types\n' +
                '- Use puer.$generic() for generic types\n' +
                '- Use puer.$ref() / puer.$unref() for out/ref parameters',
            inputSchema: z.object({
                code: z
                    .string()
                    .describe(
                        'The JavaScript code to execute. Can include multiple statements. ' +
                        'The result of the last expression is returned. ' +
                        'Example: "const go = CS.UnityEngine.GameObject.Find(\'Main Camera\'); go.transform.position.toString()"'
                    ),
            }),
            execute: async ({ code }) => {
                try {
                    // Wrap in an async IIFE so that `await` works inside the eval'd code
                    const wrappedCode = `(async () => { ${code} })()`;
                    const result = await eval(wrappedCode);

                    // Convert result to a displayable string
                    let resultStr: string;
                    if (result === undefined) {
                        resultStr = '(no return value)';
                    } else if (result === null) {
                        resultStr = 'null';
                    } else if (typeof result === 'object') {
                        try {
                            resultStr = JSON.stringify(result, null, 2);
                        } catch {
                            resultStr = String(result);
                        }
                    } else {
                        resultStr = String(result);
                    }

                    return {
                        success: true,
                        result: resultStr,
                    };
                } catch (error: any) {
                    const errorMsg = error.message || String(error);
                    const stack = error.stack || '';
                    return {
                        success: false,
                        error: errorMsg,
                        stack: stack,
                    };
                }
            },
        }),
    };
}
