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
        /// extract the exported "description" from each module, and return them.
        /// The modules are loaded from Resources/LLMAgent/builtin/ folder.
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public static string[] LoadBuiltinModules(ScriptEnv env)
        {
            var assets = Resources.LoadAll<TextAsset>("LLMAgent/builtin");
            if (assets == null || assets.Length == 0)
                return new string[0];

            var descriptions = new List<string>();
            foreach (var asset in assets)
            {
                var moduleName = asset.name; // e.g. "unity-log"
                var specifier = "LLMAgent/builtin/" + moduleName + ".mjs";
                try
                {
                    var moduleExports = env.ExecuteModule(specifier);
                    var desc = moduleExports.Get<string>("description");
                    if (!string.IsNullOrEmpty(desc))
                    {
                        descriptions.Add(desc);
                    }
                    Debug.Log($"[ScriptEnvBridge] Loaded builtin module '{specifier}'.");
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[ScriptEnvBridge] Failed to load builtin module '{specifier}': {e.Message}");
                }
            }
            return descriptions.ToArray();
        }
    }
}
