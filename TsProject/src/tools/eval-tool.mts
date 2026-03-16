/**
 * Eval Tool for AI Agent
 * Allows the LLM to execute arbitrary JavaScript code in the PuerTS runtime.
 * Since PuerTS bridges JS and C#, the evaluated code can call Unity Engine APIs
 * via the CS global object and use PuerTS helpers (puer.$ref, puer.$generic, etc.).
 */
import { tool } from 'ai';
import { z } from 'zod';

// The eval VM (jsEnv) is created once at module load time so that:
// 1. Builtin modules are loaded via ExecuteModule (making them available for dynamic import).
// 2. The summaries extracted from builtin modules can be included in the tool description.
const jsEnv: CS.Puerts.ScriptEnv = CS.LLMAgent.ScriptEnvBridge.CreateJavaScriptEnv();

// Load all builtin modules into the eval VM and collect their summaries.
const builtinSummaries: string[] = (() => {
    const csArray = CS.LLMAgent.ScriptEnvBridge.LoadBuiltinModules(jsEnv);
    const result: string[] = [];
    for (let i = 0; i < csArray.Length; i++) {
        result.push(csArray.get_Item(i));
    }
    return result;
})();

/** Builtin helper module summaries, joined for inclusion in the tool description. */
export const builtinSummariesText: string = builtinSummaries.length > 0
    ? '\n\n### Built-in Helper Modules\n\n' +
      'Several helper modules are pre-loaded in the evalJsCode VM under the path prefix `LLMAgent/builtin/`. ' +
      'Each module exports:\n' +
      '- **`description`** — a detailed string documenting every function signature and usage.\n' +
      '- **Named functions** — the actual helper functions you can call.\n\n' +
      'To use a module, load it via ESM dynamic `import()`.\n\n' +
      '**IMPORTANT**: The summaries below describe what each module does, but intentionally do NOT list function names or signatures. ' +
      'You MUST first execute a script that reads the module\'s `.description` export to discover available functions and their correct parameter signatures. ' +
      'All functions validate their arguments at runtime and will throw errors if called with wrong parameters. ' +
      'NEVER guess or assume function names — always read `.description` first.\n\n' +
      'Step 1 — Read description (first-time only):\n' +
      '```\nasync function execute() {\n' +
      '    const sv = await import(\'LLMAgent/builtin/scene-view.mjs\');\n' +
      '    return sv.description;\n' +
      '}\n```\n\n' +
      'Step 2 — Call functions after you know the signatures:\n' +
      '```\nasync function execute() {\n' +
      '    const sv = await import(\'LLMAgent/builtin/scene-view.mjs\');\n' +
      '    return sv.focusSceneViewOn(\'Main Camera\');\n' +
      '}\n```\n\n' +
      'Available modules:\n\n' +
      builtinSummaries.join('\n\n')
    : '';

// Fixed runner code that calls the globally defined execute() function,
// handles async result serialization and error reporting via onFinish callback.
const RUNNER_CODE = `(function(onFinish) {
    execute().then(function(result) {
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
                '(see PuerTS interop rules and runtime environment notes in the system prompt).\n\n' +
                'Use this tool when you need to inspect or modify Unity scene objects, ' +
                'create/destroy GameObjects or Components, query hierarchies, ' +
                'execute Unity API calls dynamically, or test code snippets in the live environment.\n\n' +
                '**Code format**: Your code MUST be an async function declaration named `execute`, for example:\n' +
                '```\nasync function execute() {\n    // your logic here\n    return someValue;\n}\n```\n' +
                'Use `return <value>` inside the function to pass a result back — the returned value will appear in the `result` field of the response. ' +
                'If no `return` statement is used, `result` will be "(no return value)". ' +
                'Objects are serialized via JSON.stringify; primitives are converted to strings.\n\n' +
                'On success the response is `{ success: true, result: string }`. ' +
                'On failure the response is `{ success: false, error: string, stack: string }`.\n\n' +
                'Use console.log() for debug output (it goes to the Unity console).' +
                builtinSummariesText,
            inputSchema: z.object({
                code: z
                    .string()
                    .describe(
                        'An async function declaration named `execute`. ' +
                        'Example: "async function execute() {\\n  const go = CS.UnityEngine.GameObject.Find(\'Main Camera\');\\n  return go.transform.position.toString();\\n}"'
                    ),
            }),
            execute: async ({ code }) => {
                try {
                    console.log(`[EvalJsTool] Executing code:\n${code}`);

                    // Step 1: Define the execute() function via EvalSync.
                    // The user code is eval'd as-is, so error line/column numbers
                    // correspond exactly to the code the AI wrote.
                    try {
                        CS.LLMAgent.ScriptEnvBridge.EvalSync(jsEnv, code);
                    } catch (defineError: any) {
                        // Syntax error or top-level error in the function definition
                        return {
                            success: false,
                            error: defineError.message || String(defineError),
                            stack: defineError.stack || '',
                        };
                    }

                    // Step 2: Run the fixed runner that calls execute() and
                    // serialises the result / error back through onFinish.
                    const resultJson = await new Promise<string>((resolve) => {
                        CS.LLMAgent.ScriptEnvBridge.Eval(jsEnv, RUNNER_CODE, resolve);
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
