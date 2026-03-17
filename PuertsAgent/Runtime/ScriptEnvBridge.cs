using Puerts;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace LLMAgent
{
    public class ScriptEnvBridge
    {
        [UnityEngine.Scripting.Preserve]
        public static ScriptEnv CreateJavaScriptEnv()
        {
            return new ScriptEnv(new BackendV8());
        }

        [UnityEngine.Scripting.Preserve]
        public static void Eval(ScriptEnv env, string script, Action<string> onFinish)
        {
            env.Eval<Action<Action<string>>>(script)(onFinish);
        }

        [UnityEngine.Scripting.Preserve]
        public static void EvalSync(ScriptEnv env, string script)
        {
            env.Eval(script);
        }

        /// <summary>
        /// Load all builtin JS modules in the given ScriptEnv via ExecuteModule,
        /// extract the exported "summary" from each module, and return them.
        /// The summaries are short descriptions shown in the tool context;
        /// full descriptions are available via dynamic import at runtime.
        /// The modules are loaded from Resources/LLMAgent/editor-assistant/builtin/ folder.
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public static string[] LoadBuiltinModules(ScriptEnv env)
        {
            var assets = Resources.LoadAll<TextAsset>("LLMAgent/editor-assistant/builtin");
            if (assets == null || assets.Length == 0)
                return new string[0];

            var summaries = new List<string>();
            foreach (var asset in assets)
            {
                var moduleName = asset.name; // e.g. "unity-log"
                var specifier = "LLMAgent/editor-assistant/builtin/" + moduleName + ".mjs";
                try
                {
                    var moduleExports = env.ExecuteModule(specifier);
                    var summary = moduleExports.Get<string>("summary");
                    if (!string.IsNullOrEmpty(summary))
                    {
                        summaries.Add(summary);
                    }
                    Debug.Log($"[ScriptEnvBridge] Loaded builtin module '{specifier}'.");
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[ScriptEnvBridge] Failed to load builtin module '{specifier}': {e.Message}");
                }
            }
            return summaries.ToArray();
        }
    }
}
