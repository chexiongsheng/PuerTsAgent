using System;
using System.IO;
using UnityEngine;
using Puerts;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace LLMAgent
{
    /// <summary>
    /// Manages PuerTS ScriptEnv lifecycle and bridges C# calls to TypeScript.
    /// Editor: uses EditorApplication.update to tick ScriptEnv.
    /// Runtime: uses a hidden MonoBehaviour Update() to tick ScriptEnv.
    /// </summary>
    public class AgentScriptManager : IDisposable
    {
        private ScriptEnv scriptEnv;
        private bool isInitialized;
        private string lastError;
        private bool isTicking;

        // TS function delegates
        private Func<string, string, string, string, string> configureAgent;
        private Action<string, string, string, Action<string, bool>> onMessageReceived;
        private Func<string, string> onMessageSync;
        private Action onClearHistory;
        private Func<int> onGetHistoryLength;
        private Func<bool> onIsConfigured;

        private const string EntryModule = "main.mjs";

#if !UNITY_EDITOR
        /// <summary>
        /// Hidden MonoBehaviour singleton for Runtime ScriptEnv ticking.
        /// </summary>
        private class ScriptEnvTicker : MonoBehaviour
        {
            public Action onTick;

            private void Update()
            {
                onTick?.Invoke();
            }
        }

        private ScriptEnvTicker ticker;
#endif

        /// <summary>
        /// Whether the TS module has been successfully loaded.
        /// </summary>
        public bool IsInitialized => isInitialized;

        /// <summary>
        /// Last error message if initialization failed.
        /// </summary>
        public string LastError => lastError;

        /// <summary>
        /// Initialize ScriptEnv and load the entry TS module.
        /// </summary>
        public void Initialize()
        {
            if (isInitialized)
                return;

            try
            {
                scriptEnv = new ScriptEnv(new BackendV8());

                // Load the ESM module and retrieve exports
                ScriptObject moduleExports = scriptEnv.ExecuteModule(EntryModule);

                // Get exported functions from TS module
                configureAgent = moduleExports.Get<Func<string, string, string, string, string>>("configureAgent");
                onMessageReceived = moduleExports.Get<Action<string, string, string, Action<string, bool>>>("onMessageReceived");
                onMessageSync = moduleExports.Get<Func<string, string>>("onMessageSync");
                onClearHistory = moduleExports.Get<Action>("onClearHistory");
                onGetHistoryLength = moduleExports.Get<Func<int>>("onGetHistoryLength");
                onIsConfigured = moduleExports.Get<Func<bool>>("onIsConfigured");

                if (onMessageReceived == null)
                {
                    lastError = "[AgentScriptManager] Failed to get 'onMessageReceived' export from module.";
                    Debug.LogError(lastError);
                    return;
                }

                isInitialized = true;
                lastError = null;

                // Start ticking ScriptEnv
                StartTicking();

                Debug.Log("[AgentScriptManager] ScriptEnv initialized and module loaded successfully.");
            }
            catch (Exception ex)
            {
                lastError = $"[AgentScriptManager] Failed to initialize: {ex.Message}";
                Debug.LogError(lastError);
                isInitialized = false;
            }
        }

        /// <summary>
        /// Start ticking the ScriptEnv to process JS microtasks.
        /// </summary>
        private void StartTicking()
        {
            if (isTicking) return;
            isTicking = true;
#if UNITY_EDITOR
            EditorApplication.update += Tick;
#else
            var go = new GameObject("[ScriptEnvTicker]");
            go.hideFlags = HideFlags.HideAndDontSave;
            UnityEngine.Object.DontDestroyOnLoad(go);
            ticker = go.AddComponent<ScriptEnvTicker>();
            ticker.onTick = Tick;
#endif
        }

        /// <summary>
        /// Stop ticking.
        /// </summary>
        private void StopTicking()
        {
            if (!isTicking) return;
            isTicking = false;
#if UNITY_EDITOR
            EditorApplication.update -= Tick;
#else
            if (ticker != null)
            {
                UnityEngine.Object.Destroy(ticker.gameObject);
                ticker = null;
            }
#endif
        }

        /// <summary>
        /// Called every frame to process pending JS microtasks.
        /// </summary>
        private void Tick()
        {
            if (scriptEnv != null)
            {
                try
                {
                    scriptEnv.Tick();
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[AgentScriptManager] Tick error: {ex.Message}");
                }
            }
        }

        /// <summary>
        /// Configure the agent with API settings.
        /// </summary>
        public string ConfigureAgent(string apiKey, string baseURL = "", string model = "", string systemPrompt = "")
        {
            if (!isInitialized || configureAgent == null)
            {
                return "[AgentScriptManager] Not initialized.";
            }

            try
            {
                return configureAgent(apiKey, baseURL, model, systemPrompt);
            }
            catch (Exception ex)
            {
                string err = $"[AgentScriptManager] Error configuring agent: {ex.Message}";
                Debug.LogError(err);
                return err;
            }
        }

        /// <summary>
        /// Send a message to the TS side asynchronously via callback pattern.
        /// Optionally includes an image file path to attach.
        /// </summary>
        public void SendMessageAsync(string message, string imagePath, Action<string, bool> onResponse)
        {
            if (!isInitialized || onMessageReceived == null)
            {
                onResponse?.Invoke("[AgentScriptManager] Not initialized. Cannot send message.", true);
                return;
            }

            try
            {
                string imageBase64 = "";
                string mimeType = "";

                if (!string.IsNullOrEmpty(imagePath) && File.Exists(imagePath))
                {
                    byte[] imageBytes = File.ReadAllBytes(imagePath);
                    imageBase64 = Convert.ToBase64String(imageBytes);

                    string ext = Path.GetExtension(imagePath).ToLowerInvariant();
                    switch (ext)
                    {
                        case ".png": mimeType = "image/png"; break;
                        case ".jpg":
                        case ".jpeg": mimeType = "image/jpeg"; break;
                        case ".gif": mimeType = "image/gif"; break;
                        case ".bmp": mimeType = "image/bmp"; break;
                        case ".webp": mimeType = "image/webp"; break;
                        case ".tga": mimeType = "image/tga"; break;
                        default: mimeType = "image/png"; break;
                    }

                    Debug.Log($"[AgentScriptManager] Attaching image: {imagePath} ({imageBytes.Length} bytes, {mimeType})");
                }

                onMessageReceived(message, imageBase64, mimeType, (response, isError) =>
                {
                    onResponse?.Invoke(response, isError);
                });
            }
            catch (Exception ex)
            {
                string err = $"[AgentScriptManager] Error calling TS: {ex.Message}";
                Debug.LogError(err);
                onResponse?.Invoke(err, true);
            }
        }

        /// <summary>
        /// Check if the agent is configured.
        /// </summary>
        public bool IsAgentConfigured()
        {
            if (!isInitialized || onIsConfigured == null)
                return false;

            try
            {
                return onIsConfigured();
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Clear conversation history.
        /// </summary>
        public void ClearHistory()
        {
            if (isInitialized && onClearHistory != null)
            {
                try
                {
                    onClearHistory();
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[AgentScriptManager] Error clearing history: {ex.Message}");
                }
            }
        }

        /// <summary>
        /// Get conversation history length.
        /// </summary>
        public int GetHistoryLength()
        {
            if (!isInitialized || onGetHistoryLength == null)
                return 0;

            try
            {
                return onGetHistoryLength();
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>
        /// Release ScriptEnv resources.
        /// </summary>
        public void Dispose()
        {
            StopTicking();

            configureAgent = null;
            onMessageReceived = null;
            onMessageSync = null;
            onClearHistory = null;
            onGetHistoryLength = null;
            onIsConfigured = null;
            isInitialized = false;

            if (scriptEnv != null)
            {
                try
                {
                    scriptEnv.Dispose();
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[AgentScriptManager] Error disposing ScriptEnv: {ex.Message}");
                }
                scriptEnv = null;
            }
        }
    }
}
