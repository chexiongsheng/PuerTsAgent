using System;
using System.Collections.Generic;
using UnityEngine;

namespace LLMAgent
{
    /// <summary>
    /// Simple runtime LLM Agent chat UI using OnGUI (IMGUI).
    /// Attach this to any GameObject in the scene.
    /// </summary>
    public class RuntimeAgentChat : MonoBehaviour
    {
        [Header("API Settings")]
        [SerializeField] private string apiKey = "";
        [SerializeField] private string baseURL = "";
        [SerializeField] private string model = "";

        private AgentScriptManager agentManager;
        private string inputText = "";
        private Vector2 scrollPosition;
        private bool isWaiting = false;
        private bool showSettings = true;

        private struct ChatMessage
        {
            public string role;
            public string content;
        }

        private List<ChatMessage> chatHistory = new List<ChatMessage>();

        private void Start()
        {
            agentManager = new AgentScriptManager();
            agentManager.Initialize();

            if (agentManager.IsInitialized)
            {
                Debug.Log("[RuntimeAgentChat] Agent initialized successfully.");
            }
            else
            {
                Debug.LogError($"[RuntimeAgentChat] Agent failed to initialize: {agentManager.LastError}");
            }
        }

        private void OnDestroy()
        {
            agentManager?.Dispose();
            agentManager = null;
        }

        private void OnGUI()
        {
            float screenW = Screen.width;
            float screenH = Screen.height;
            float panelW = Mathf.Min(600, screenW - 40);
            float panelH = screenH - 40;
            float panelX = (screenW - panelW) / 2f;
            float panelY = 20;

            // Background box
            GUI.Box(new Rect(panelX, panelY, panelW, panelH), "LLM Agent Chat");

            float innerX = panelX + 10;
            float innerW = panelW - 20;
            float currentY = panelY + 25;

            // --- Settings toggle ---
            if (GUI.Button(new Rect(innerX, currentY, 100, 25), showSettings ? "Hide Settings" : "Settings"))
            {
                showSettings = !showSettings;
            }
            currentY += 30;

            if (showSettings)
            {
                // API Key
                GUI.Label(new Rect(innerX, currentY, 80, 20), "API Key:");
                apiKey = GUI.PasswordField(new Rect(innerX + 85, currentY, innerW - 85, 20), apiKey, '*');
                currentY += 25;

                // Base URL
                GUI.Label(new Rect(innerX, currentY, 80, 20), "Base URL:");
                baseURL = GUI.TextField(new Rect(innerX + 85, currentY, innerW - 85, 20), baseURL);
                currentY += 25;

                // Model
                GUI.Label(new Rect(innerX, currentY, 80, 20), "Model:");
                model = GUI.TextField(new Rect(innerX + 85, currentY, innerW - 85, 20), model);
                currentY += 25;

                // Configure button
                if (GUI.Button(new Rect(innerX, currentY, 120, 28), "Configure"))
                {
                    if (agentManager != null && agentManager.IsInitialized)
                    {
                        string result = agentManager.ConfigureAgent(apiKey, baseURL, model);
                        Debug.Log($"[RuntimeAgentChat] Configure result: {result}");
                        chatHistory.Add(new ChatMessage { role = "system", content = $"Configure: {result}" });
                    }
                }

                // Clear history button
                if (GUI.Button(new Rect(innerX + 130, currentY, 120, 28), "Clear History"))
                {
                    agentManager?.ClearHistory();
                    chatHistory.Clear();
                }

                currentY += 35;
            }

            // --- Chat area ---
            float chatAreaHeight = panelH - (currentY - panelY) - 75;
            Rect chatRect = new Rect(innerX, currentY, innerW, chatAreaHeight);

            // Draw chat messages
            GUILayout.BeginArea(chatRect);
            scrollPosition = GUILayout.BeginScrollView(scrollPosition);

            foreach (var msg in chatHistory)
            {
                GUIStyle style = new GUIStyle(GUI.skin.label);
                style.wordWrap = true;
                style.richText = true;

                string prefix;
                switch (msg.role)
                {
                    case "user":
                        prefix = "<b><color=#4488ff>You:</color></b> ";
                        break;
                    case "assistant":
                        prefix = "<b><color=#44cc44>Agent:</color></b> ";
                        break;
                    default:
                        prefix = "<b><color=#cccc44>System:</color></b> ";
                        break;
                }

                GUILayout.Label(prefix + msg.content, style);
                GUILayout.Space(5);
            }

            if (isWaiting)
            {
                GUIStyle waitStyle = new GUIStyle(GUI.skin.label);
                waitStyle.fontStyle = FontStyle.Italic;
                GUILayout.Label("Agent is thinking...", waitStyle);
            }

            GUILayout.EndScrollView();
            GUILayout.EndArea();

            currentY += chatAreaHeight + 5;

            // --- Input area ---
            float sendBtnW = 70;
            float inputW = innerW - sendBtnW - 5;

            inputText = GUI.TextField(new Rect(innerX, currentY, inputW, 30), inputText);

            bool canSend = !isWaiting && !string.IsNullOrEmpty(inputText) &&
                           agentManager != null && agentManager.IsInitialized;

            if (isWaiting)
            {
                // Show Stop button during generation
                if (GUI.Button(new Rect(innerX + inputW + 5, currentY, sendBtnW, 30), "Stop"))
                {
                    if (agentManager != null && agentManager.IsInitialized)
                    {
                        agentManager.AbortGeneration();
                    }
                }
            }
            else
            {
                GUI.enabled = canSend;
                bool sendClicked = GUI.Button(new Rect(innerX + inputW + 5, currentY, sendBtnW, 30), "Send");
                GUI.enabled = true;

                // Send on button click or Enter key
                if (canSend && (sendClicked || (Event.current.type == EventType.KeyDown && Event.current.keyCode == KeyCode.Return)))
                {
                    SendMessage(inputText);
                    inputText = "";
                }
            }
        }

        private void SendMessage(string message)
        {
            chatHistory.Add(new ChatMessage { role = "user", content = message });
            isWaiting = true;

            agentManager.SendMessageAsync(message, null, (response, isError) =>
            {
                isWaiting = false;
                chatHistory.Add(new ChatMessage
                {
                    role = isError ? "system" : "assistant",
                    content = response
                });
                // Auto-scroll to bottom
                scrollPosition = new Vector2(0, float.MaxValue);
            });
        }
    }
}
