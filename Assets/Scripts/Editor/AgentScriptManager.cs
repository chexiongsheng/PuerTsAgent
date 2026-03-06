using System;
using UnityEngine;
using Puerts;

namespace LLMAgent.Editor
{
    /// <summary>
    /// Manages PuerTS ScriptEnv lifecycle and bridges C# calls to TypeScript.
    /// Supports both sync and async message handling for LLM Agent.
    /// </summary>
    public class AgentScriptManager : IDisposable
    {
        private ScriptEnv scriptEnv;
        private bool isInitialized;
        private string lastError;

        // TS function delegates
        private Func<string, string, string, string, string> configureAgent;
        private Action<string, Action<string, bool>> onMessageReceived;  // (message, callback) -> void, async with callback
        private Func<string, string> onMessageSync;        // Sync echo for testing
        private Action onClearHistory;
        private Func<int> onGetHistoryLength;
        private Func<bool> onIsConfigured;

        private const string EntryModule = "main.mjs";

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
                onMessageReceived = moduleExports.Get<Action<string, Action<string, bool>>>("onMessageReceived");
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
        /// The C# Action callback is passed directly to TS and invoked when done.
        /// </summary>
        /// <param name="message">User input text</param>
        /// <param name="onResponse">Callback: (response, isError)</param>
        public void SendMessageAsync(string message, Action<string, bool> onResponse)
        {
            if (!isInitialized || onMessageReceived == null)
            {
                onResponse?.Invoke("[AgentScriptManager] Not initialized. Cannot send message.", true);
                return;
            }

            try
            {
                bool completed = false;

                // Pass the C# callback directly to TS side
                Action<string, bool> wrappedCallback = (response, isError) =>
                {
                    onResponse?.Invoke(response, isError);
                    completed = true;
                };

                onMessageReceived(message, wrappedCallback);

                // Tick the ScriptEnv to process JS microtasks (Promise resolution)
                // Since our fetch is synchronous, the Promise chain should resolve
                // within a few ticks.
                for (int i = 0; i < 100; i++)
                {
                    if (completed)
                        break;

                    scriptEnv.Tick();
                    System.Threading.Thread.Sleep(10);
                }
            }
            catch (Exception ex)
            {
                string err = $"[AgentScriptManager] Error calling TS: {ex.Message}";
                Debug.LogError(err);
                onResponse?.Invoke(err, true);
            }
        }

        /// <summary>
        /// Send a message synchronously and wait for the response.
        /// </summary>
        public string SendMessage(string message)
        {
            if (!isInitialized || onMessageReceived == null)
            {
                return "[AgentScriptManager] Not initialized. Cannot send message.";
            }

            string result = null;
            bool completed = false;

            SendMessageAsync(message, (response, isError) =>
            {
                result = response;
                completed = true;
            });

            if (completed && result != null)
            {
                return result;
            }

            return result ?? "[AgentScriptManager] Timeout waiting for response.";
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
