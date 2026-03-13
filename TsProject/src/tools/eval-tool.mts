/**
 * Eval Tool for AI Agent
 * Allows the LLM to execute arbitrary JavaScript code in the PuerTS runtime.
 * Since PuerTS bridges JS and C#, the evaluated code can call Unity Engine APIs
 * via the CS global object and use PuerTS helpers (puer.$ref, puer.$generic, etc.).
 */
import { tool } from 'ai';
import { z } from 'zod';

var jsEnv: CS.Puerts.ScriptEnv = null as never;

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
                'Execute JavaScript code in a dedicated PuerTS runtime environment. ' +
                'This VM is separate from the main agent VM but is **reused across calls** — ' +
                'variables, functions, and state defined in previous calls persist and can be referenced in later calls.\n\n' +
                'The code runs inside Unity via PuerTS with full access to the `CS` and `puer` globals ' +
                '(see PuerTS interop rules in the system prompt).\n\n' +
                'Use this tool when you need to inspect or modify Unity scene objects, ' +
                'create/destroy GameObjects or Components, query hierarchies, ' +
                'execute Unity API calls dynamically, or test code snippets in the live environment.\n\n' +
                'The code is wrapped in an async context, so you can use `await`. ' +
                'Use `return <value>` to pass a result back — the returned value will appear in the `result` field of the response. ' +
                'If no `return` statement is used, `result` will be "(no return value)". ' +
                'Objects are serialized via JSON.stringify; primitives are converted to strings.\n\n' +
                'On success the response is `{ success: true, result: string }`. ' +
                'On failure the response is `{ success: false, error: string, stack: string }`.\n\n' +
                'Use console.log() for debug output (it goes to the Unity console).',
            inputSchema: z.object({
                code: z
                    .string()
                    .describe(
                        'The JavaScript code to execute. Can include multiple statements. ' +
                        'Use `return <expr>` to send a value back as the result. ' +
                        'Example: "const go = CS.UnityEngine.GameObject.Find(\'Main Camera\'); return go.transform.position.toString()"'
                    ),
            }),
            execute: async ({ code }) => {
                try {
                    if (!jsEnv) {
                        jsEnv = CS.LLMAgent.ScriptEnvBridge.CreateJavaScriptEnv();
                    }
                    console.log(`[EvalJsTool] Executing code:\n${code}`);

                    // Wrap user code into a script that ScriptEnvBridge.Eval expects:
                    // The script must evaluate to a function that accepts an onFinish callback.
                    // We use an async IIFE inside so that `await` works, then serialize the result
                    // and pass it back via onFinish(resultString).
                    const wrappedCode = `(function(onFinish) {
    (async () => {
        try {
            ${code}
        } catch(e) {
            onFinish.Invoke(JSON.stringify({ __error: true, message: String(e.message || e), stack: String(e.stack || '') }));
        }
    })().then(function(result) {
        var resultStr;
        if (result === undefined) {
            resultStr = '(no return value)';
        } else if (result === null) {
            resultStr = 'null';
        } else if (typeof result === 'object') {
            try { resultStr = JSON.stringify(result, null, 2); } catch(e) { resultStr = String(result); }
        } else {
            resultStr = String(result);
        }
        onFinish.Invoke(JSON.stringify({ __error: false, result: resultStr }));
    }).catch(function(err) {
        onFinish.Invoke(JSON.stringify({ __error: true, message: String(err.message || err), stack: String(err.stack || '') }));
    });
})`;

                    // Execute in the isolated ScriptEnv VM via C# bridge
                    const resultJson = await new Promise<string>((resolve) => {
                        CS.LLMAgent.ScriptEnvBridge.Eval(jsEnv, wrappedCode, resolve);
                    });

                    const parsed = JSON.parse(resultJson);
                    if (parsed.__error) {
                        return {
                            success: false,
                            error: parsed.message,
                            stack: parsed.stack || '',
                        };
                    }

                    return {
                        success: true,
                        result: parsed.result,
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
