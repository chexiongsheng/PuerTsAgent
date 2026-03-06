using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace LLMAgent.Editor
{
    /// <summary>
    /// Editor window providing a polished chat interface for the LLM Agent.
    /// </summary>
    public class AgentChatWindow : EditorWindow
    {
        private AgentScriptManager scriptManager;
        private string inputText = "";
        private Vector2 scrollPosition;
        private readonly List<ChatMessage> messages = new List<ChatMessage>();
        private bool shouldScrollToBottom;
        private bool isWaitingForResponse;

        // Settings
        private bool showSettings;
        private string apiKey = "";
        private string baseURL = "";
        private string model = "gpt-4o-mini";
        private string systemPrompt = "You are a helpful AI assistant running inside Unity Editor. You can help with game development, scripting, and general questions. Be concise and practical.";

        // EditorPrefs keys for persistence
        private const string PrefKeyApiKey = "LLMAgent_ApiKey";
        private const string PrefKeyBaseURL = "LLMAgent_BaseURL";
        private const string PrefKeyModel = "LLMAgent_Model";
        private const string PrefKeySystemPrompt = "LLMAgent_SystemPrompt";

        private const string InputControlName = "AgentChatInput";

        // Cached styles (rebuilt on demand)
        private bool stylesInitialized;
        private GUIStyle headerStyle;
        private GUIStyle statusDotStyle;
        private GUIStyle userBubbleStyle;
        private GUIStyle agentBubbleStyle;
        private GUIStyle userLabelStyle;
        private GUIStyle agentLabelStyle;
        private GUIStyle timestampStyle;
        private GUIStyle inputFieldStyle;
        private GUIStyle sendButtonStyle;
        private GUIStyle clearButtonStyle;
        private GUIStyle welcomeStyle;
        private GUIStyle welcomeSubStyle;
        private GUIStyle inputAreaStyle;
        private GUIStyle settingsPanelStyle;
        private GUIStyle settingsLabelStyle;
        private GUIStyle settingsFieldStyle;

        // Cached textures
        private Texture2D settingsBgTex;
        private Texture2D userBubbleTex;
        private Texture2D agentBubbleTex;
        private Texture2D headerBgTex;
        private Texture2D inputAreaBgTex;
        private Texture2D sendBtnNormalTex;
        private Texture2D sendBtnHoverTex;
        private Texture2D inputFieldBgTex;

        /// <summary>
        /// Represents a single chat message.
        /// </summary>
        private struct ChatMessage
        {
            public string Text;
            public bool IsUser;
            public string Timestamp;
        }

        [MenuItem("LLM Agent/Chat Window")]
        public static void ShowWindow()
        {
            var window = GetWindow<AgentChatWindow>("LLM Agent Chat");
            window.minSize = new Vector2(450, 350);
            window.Show();
        }

        private void OnEnable()
        {
            stylesInitialized = false;
            LoadSettings();
            InitializeScriptManager();
        }

        private void LoadSettings()
        {
            apiKey = EditorPrefs.GetString(PrefKeyApiKey, "");
            baseURL = EditorPrefs.GetString(PrefKeyBaseURL, "");
            model = EditorPrefs.GetString(PrefKeyModel, "gpt-4o-mini");
            systemPrompt = EditorPrefs.GetString(PrefKeySystemPrompt,
                "You are a helpful AI assistant running inside Unity Editor. You can help with game development, scripting, and general questions. Be concise and practical.");
        }

        private void SaveSettings()
        {
            EditorPrefs.SetString(PrefKeyApiKey, apiKey);
            EditorPrefs.SetString(PrefKeyBaseURL, baseURL);
            EditorPrefs.SetString(PrefKeyModel, model);
            EditorPrefs.SetString(PrefKeySystemPrompt, systemPrompt);
        }

        private void InitializeScriptManager()
        {
            if (scriptManager != null)
            {
                scriptManager.Dispose();
            }

            scriptManager = new AgentScriptManager();
            scriptManager.Initialize();

            // Auto-configure if API key is available
            if (scriptManager.IsInitialized && !string.IsNullOrEmpty(apiKey))
            {
                scriptManager.ConfigureAgent(apiKey, baseURL, model, systemPrompt);
            }
        }

        #region Texture Helpers

        private Texture2D MakeTex(int width, int height, Color color)
        {
            var pixels = new Color[width * height];
            for (int i = 0; i < pixels.Length; i++)
                pixels[i] = color;
            var tex = new Texture2D(width, height);
            tex.SetPixels(pixels);
            tex.Apply();
            return tex;
        }

        private Texture2D MakeRoundedTex(int width, int height, Color color, int radius)
        {
            var tex = new Texture2D(width, height);
            var pixels = new Color[width * height];
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    // Check corners for rounding
                    bool inCorner = false;
                    int cx = 0, cy = 0;

                    if (x < radius && y < radius) { cx = radius; cy = radius; inCorner = true; }
                    else if (x >= width - radius && y < radius) { cx = width - radius; cy = radius; inCorner = true; }
                    else if (x < radius && y >= height - radius) { cx = radius; cy = height - radius; inCorner = true; }
                    else if (x >= width - radius && y >= height - radius) { cx = width - radius; cy = height - radius; inCorner = true; }

                    if (inCorner)
                    {
                        float dist = Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
                        if (dist > radius)
                            pixels[y * width + x] = Color.clear;
                        else if (dist > radius - 1.5f)
                            pixels[y * width + x] = new Color(color.r, color.g, color.b, color.a * (radius - dist) / 1.5f);
                        else
                            pixels[y * width + x] = color;
                    }
                    else
                    {
                        pixels[y * width + x] = color;
                    }
                }
            }
            tex.SetPixels(pixels);
            tex.Apply();
            return tex;
        }

        #endregion

        #region Style Initialization

        private void InitStyles()
        {
            if (stylesInitialized) return;

            bool isDark = EditorGUIUtility.isProSkin;

            // Colors
            Color headerBg = isDark ? new Color(0.16f, 0.16f, 0.20f) : new Color(0.22f, 0.45f, 0.85f);
            Color userBubbleColor = isDark ? new Color(0.20f, 0.40f, 0.70f, 0.85f) : new Color(0.26f, 0.52f, 0.96f, 0.90f);
            Color agentBubbleColor = isDark ? new Color(0.22f, 0.24f, 0.28f, 0.90f) : new Color(0.92f, 0.93f, 0.95f, 0.95f);
            Color inputAreaBg = isDark ? new Color(0.18f, 0.18f, 0.22f) : new Color(0.95f, 0.95f, 0.97f);
            Color sendBtnNormal = isDark ? new Color(0.25f, 0.55f, 0.95f) : new Color(0.26f, 0.52f, 0.96f);
            Color sendBtnHover = isDark ? new Color(0.35f, 0.65f, 1.0f) : new Color(0.36f, 0.62f, 1.0f);
            Color inputFieldBg = isDark ? new Color(0.14f, 0.14f, 0.17f) : new Color(1f, 1f, 1f);

            // Generate textures
            headerBgTex = MakeTex(4, 4, headerBg);
            userBubbleTex = MakeRoundedTex(32, 32, userBubbleColor, 8);
            agentBubbleTex = MakeRoundedTex(32, 32, agentBubbleColor, 8);
            inputAreaBgTex = MakeTex(4, 4, inputAreaBg);
            sendBtnNormalTex = MakeRoundedTex(16, 16, sendBtnNormal, 4);
            sendBtnHoverTex = MakeRoundedTex(16, 16, sendBtnHover, 4);
            inputFieldBgTex = MakeRoundedTex(16, 16, inputFieldBg, 4);

            // Header title style
            headerStyle = new GUIStyle(EditorStyles.boldLabel)
            {
                fontSize = 15,
                alignment = TextAnchor.MiddleLeft,
                padding = new RectOffset(12, 12, 0, 0),
                normal = { textColor = Color.white }
            };

            // Status indicator dot
            statusDotStyle = new GUIStyle(EditorStyles.label)
            {
                fontSize = 10,
                alignment = TextAnchor.MiddleLeft,
                normal = { textColor = new Color(0.3f, 0.9f, 0.4f) },
                padding = new RectOffset(0, 0, 0, 0)
            };

            // User bubble
            userBubbleStyle = new GUIStyle()
            {
                normal = { background = userBubbleTex },
                border = new RectOffset(10, 10, 10, 10),
                padding = new RectOffset(12, 12, 8, 8),
                margin = new RectOffset(60, 8, 2, 2),
                wordWrap = true,
                richText = true,
                fontSize = 12,
                stretchWidth = false
            };

            // Agent bubble
            agentBubbleStyle = new GUIStyle()
            {
                normal = { background = agentBubbleTex },
                border = new RectOffset(10, 10, 10, 10),
                padding = new RectOffset(12, 12, 8, 8),
                margin = new RectOffset(8, 60, 2, 2),
                wordWrap = true,
                richText = true,
                fontSize = 12,
                stretchWidth = false
            };

            // User message label
            userLabelStyle = new GUIStyle(EditorStyles.label)
            {
                fontSize = 12,
                wordWrap = true,
                richText = true,
                normal = { textColor = isDark ? new Color(0.95f, 0.95f, 1.0f) : Color.white },
                padding = new RectOffset(0, 0, 0, 0)
            };

            // Agent message label
            agentLabelStyle = new GUIStyle(EditorStyles.label)
            {
                fontSize = 12,
                wordWrap = true,
                richText = true,
                normal = { textColor = isDark ? new Color(0.85f, 0.87f, 0.90f) : new Color(0.15f, 0.15f, 0.20f) },
                padding = new RectOffset(0, 0, 0, 0)
            };

            // Timestamp
            timestampStyle = new GUIStyle(EditorStyles.miniLabel)
            {
                fontSize = 9,
                normal = { textColor = isDark ? new Color(0.5f, 0.52f, 0.58f) : new Color(0.55f, 0.55f, 0.60f) },
                padding = new RectOffset(0, 0, 2, 0)
            };

            // Input text field
            inputFieldStyle = new GUIStyle(EditorStyles.textField)
            {
                fontSize = 13,
                wordWrap = true,
                padding = new RectOffset(10, 10, 8, 8),
                normal = { background = inputFieldBgTex, textColor = isDark ? new Color(0.9f, 0.9f, 0.93f) : new Color(0.1f, 0.1f, 0.15f) },
                focused = { background = inputFieldBgTex, textColor = isDark ? new Color(0.95f, 0.95f, 1.0f) : new Color(0.05f, 0.05f, 0.1f) }
            };

            // Send button
            sendButtonStyle = new GUIStyle()
            {
                fontSize = 13,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleCenter,
                normal = { background = sendBtnNormalTex, textColor = Color.white },
                hover = { background = sendBtnHoverTex, textColor = Color.white },
                active = { background = sendBtnHoverTex, textColor = new Color(0.85f, 0.85f, 0.9f) },
                border = new RectOffset(4, 4, 4, 4),
                padding = new RectOffset(14, 14, 6, 6),
                margin = new RectOffset(4, 0, 0, 0)
            };

            // Clear button
            clearButtonStyle = new GUIStyle(EditorStyles.miniButton)
            {
                fontSize = 10,
                padding = new RectOffset(6, 6, 2, 2),
                margin = new RectOffset(4, 8, 0, 0)
            };

            // Input area background
            inputAreaStyle = new GUIStyle()
            {
                normal = { background = inputAreaBgTex },
                padding = new RectOffset(10, 10, 10, 10)
            };

            // Welcome styles
            welcomeStyle = new GUIStyle(EditorStyles.boldLabel)
            {
                fontSize = 18,
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = isDark ? new Color(0.6f, 0.65f, 0.75f) : new Color(0.35f, 0.40f, 0.55f) },
                wordWrap = true
            };

            welcomeSubStyle = new GUIStyle(EditorStyles.label)
            {
                fontSize = 12,
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = isDark ? new Color(0.45f, 0.48f, 0.55f) : new Color(0.50f, 0.52f, 0.58f) },
                wordWrap = true
            };

            // Settings panel
            Color settingsBg = isDark ? new Color(0.17f, 0.17f, 0.21f) : new Color(0.93f, 0.94f, 0.96f);
            settingsBgTex = MakeTex(4, 4, settingsBg);

            settingsPanelStyle = new GUIStyle()
            {
                normal = { background = settingsBgTex },
                padding = new RectOffset(12, 12, 8, 8)
            };

            settingsLabelStyle = new GUIStyle(EditorStyles.boldLabel)
            {
                fontSize = 11,
                normal = { textColor = isDark ? new Color(0.75f, 0.78f, 0.85f) : new Color(0.25f, 0.28f, 0.35f) }
            };

            settingsFieldStyle = new GUIStyle(EditorStyles.textField)
            {
                fontSize = 12,
                padding = new RectOffset(6, 6, 4, 4)
            };

            stylesInitialized = true;
        }

        #endregion

        private void OnGUI()
        {
            InitStyles();

            DrawHeader();

            // Error banner if TS module failed to load
            if (scriptManager == null || !scriptManager.IsInitialized)
            {
                DrawErrorBanner();
            }

            // Settings panel (collapsible)
            if (showSettings)
            {
                DrawSettingsPanel();
                DrawSeparator();
            }

            // Message list area
            DrawMessageList();

            // Separator line
            DrawSeparator();

            // Input area
            DrawInputArea();
        }

        #region Header

        private void DrawHeader()
        {
            Rect headerRect = EditorGUILayout.BeginHorizontal(GUILayout.Height(42));
            if (headerBgTex != null)
            {
                GUI.DrawTexture(headerRect, headerBgTex, ScaleMode.StretchToFill);
            }

            GUILayout.Space(12);

            // Agent icon – use Unity built-in icon
            GUIContent agentIcon = EditorGUIUtility.IconContent("d_console.infoicon.sml");
            if (agentIcon == null || agentIcon.image == null)
                agentIcon = new GUIContent("\u2726"); // fallback
            GUIStyle iconStyle = new GUIStyle(EditorStyles.boldLabel)
            {
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = Color.white }
            };
            GUILayout.Label(agentIcon, iconStyle, GUILayout.Width(24), GUILayout.Height(42));

            // Title
            GUILayout.Label("LLM Agent", headerStyle, GUILayout.Height(42));

            GUILayout.FlexibleSpace();

            // Settings gear button – use Unity built-in icon so it always renders
            GUIContent gearIcon = EditorGUIUtility.IconContent("d_Settings");
            if (gearIcon == null || gearIcon.image == null)
                gearIcon = EditorGUIUtility.IconContent("Settings");
            if (gearIcon == null || gearIcon.image == null)
                gearIcon = EditorGUIUtility.IconContent("_Popup");
            if (gearIcon == null || gearIcon.image == null)
                gearIcon = new GUIContent("S"); // ultimate fallback

            GUIStyle gearBtnStyle = new GUIStyle(GUI.skin.button)
            {
                padding = new RectOffset(4, 4, 4, 4),
                margin = new RectOffset(4, 4, 9, 9),
                fixedWidth = 28,
                fixedHeight = 24
            };
            if (GUILayout.Button(gearIcon, gearBtnStyle))
            {
                showSettings = !showSettings;
            }

            GUILayout.Space(4);

            // Status dot + text
            bool isOnline = scriptManager != null && scriptManager.IsInitialized;
            bool isConfigured = isOnline && scriptManager.IsAgentConfigured();
            if (isWaitingForResponse)
            {
                statusDotStyle.normal.textColor = new Color(1.0f, 0.8f, 0.2f);
                GUILayout.Label("\u25CF Thinking...", statusDotStyle, GUILayout.Height(42));
            }
            else if (isConfigured)
            {
                statusDotStyle.normal.textColor = new Color(0.3f, 0.9f, 0.4f);
                GUILayout.Label("\u25CF Ready", statusDotStyle, GUILayout.Height(42));
            }
            else if (isOnline)
            {
                statusDotStyle.normal.textColor = new Color(1.0f, 0.7f, 0.2f);
                GUILayout.Label("\u25CF No API Key", statusDotStyle, GUILayout.Height(42));
            }
            else
            {
                statusDotStyle.normal.textColor = new Color(0.9f, 0.35f, 0.3f);
                GUILayout.Label("\u25CF Offline", statusDotStyle, GUILayout.Height(42));
            }

            GUILayout.Space(12);

            EditorGUILayout.EndHorizontal();
        }

        #endregion

        #region Error Banner

        private void DrawErrorBanner()
        {
            EditorGUILayout.BeginHorizontal();
            GUILayout.Space(8);
            EditorGUILayout.BeginVertical();
            GUILayout.Space(4);

            EditorGUILayout.HelpBox(
                scriptManager?.LastError ?? "ScriptManager not initialized.",
                MessageType.Error
            );

            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("  Retry  ", EditorStyles.miniButton))
            {
                InitializeScriptManager();
            }
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();

            GUILayout.Space(4);
            EditorGUILayout.EndVertical();
            GUILayout.Space(8);
            EditorGUILayout.EndHorizontal();
        }

        #endregion

        #region Settings Panel

        private void DrawSettingsPanel()
        {
            EditorGUILayout.BeginVertical(settingsPanelStyle);

            GUILayout.Label("\u2699  Agent Settings", settingsLabelStyle);
            GUILayout.Space(4);

            EditorGUI.BeginChangeCheck();

            // API Key (password field)
            EditorGUILayout.BeginHorizontal();
            GUILayout.Label("API Key", GUILayout.Width(90));
            apiKey = EditorGUILayout.PasswordField(apiKey, settingsFieldStyle);
            EditorGUILayout.EndHorizontal();
            GUILayout.Space(2);

            // Base URL
            EditorGUILayout.BeginHorizontal();
            GUILayout.Label("Base URL", GUILayout.Width(90));
            baseURL = EditorGUILayout.TextField(baseURL, settingsFieldStyle);
            EditorGUILayout.EndHorizontal();
            GUILayout.Space(2);

            // Model
            EditorGUILayout.BeginHorizontal();
            GUILayout.Label("Model", GUILayout.Width(90));
            model = EditorGUILayout.TextField(model, settingsFieldStyle);
            EditorGUILayout.EndHorizontal();
            GUILayout.Space(2);

            // System Prompt
            GUILayout.Label("System Prompt", GUILayout.Width(90));
            systemPrompt = EditorGUILayout.TextArea(systemPrompt, settingsFieldStyle, GUILayout.MinHeight(40), GUILayout.MaxHeight(80));

            GUILayout.Space(4);

            // Apply button
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();

            if (GUILayout.Button("  Apply Settings  ", EditorStyles.miniButton))
            {
                SaveSettings();
                ApplySettings();
            }

            EditorGUILayout.EndHorizontal();

            if (EditorGUI.EndChangeCheck())
            {
                // Settings changed, will be applied when user clicks Apply
            }

            GUILayout.Space(4);
            EditorGUILayout.EndVertical();
        }

        private void ApplySettings()
        {
            if (scriptManager != null && scriptManager.IsInitialized)
            {
                string result = scriptManager.ConfigureAgent(apiKey, baseURL, model, systemPrompt);
                messages.Add(new ChatMessage
                {
                    Text = result,
                    IsUser = false,
                    Timestamp = DateTime.Now.ToString("HH:mm")
                });
                shouldScrollToBottom = true;
                Repaint();
            }
        }

        #endregion

        #region Message List

        private void DrawMessageList()
        {
            scrollPosition = EditorGUILayout.BeginScrollView(scrollPosition, GUIStyle.none, GUI.skin.verticalScrollbar, GUILayout.ExpandHeight(true));

            GUILayout.Space(8);

            if (messages.Count == 0)
            {
                DrawWelcome();
            }
            else
            {
                foreach (var msg in messages)
                {
                    DrawMessage(msg);
                    GUILayout.Space(4);
                }
            }

            GUILayout.Space(8);

            EditorGUILayout.EndScrollView();

            // Auto scroll to bottom when new message added
            if (shouldScrollToBottom)
            {
                scrollPosition.y = float.MaxValue;
                shouldScrollToBottom = false;
                Repaint();
            }
        }

        private void DrawWelcome()
        {
            GUILayout.FlexibleSpace();

            EditorGUILayout.BeginVertical();
            GUILayout.Space(20);

            GUIStyle emojiStyle = new GUIStyle(EditorStyles.label)
            {
                fontSize = 36,
                alignment = TextAnchor.MiddleCenter
            };
            GUILayout.Label("\U0001F916", emojiStyle, GUILayout.ExpandWidth(true), GUILayout.Height(50));

            GUILayout.Space(8);
            GUILayout.Label("Welcome to LLM Agent", welcomeStyle, GUILayout.ExpandWidth(true));
            GUILayout.Space(4);

            bool isConfigured = scriptManager != null && scriptManager.IsInitialized && scriptManager.IsAgentConfigured();
            string subText = isConfigured
                ? "Type a message below to start chatting."
                : "Click the \u2699 gear icon to configure your API key first.";
            GUILayout.Label(subText, welcomeSubStyle, GUILayout.ExpandWidth(true));

            GUILayout.Space(20);
            EditorGUILayout.EndVertical();

            GUILayout.FlexibleSpace();
        }

        private void DrawMessage(ChatMessage msg)
        {
            if (msg.IsUser)
            {
                DrawUserMessage(msg);
            }
            else
            {
                DrawAgentMessage(msg);
            }
        }

        private void DrawUserMessage(ChatMessage msg)
        {
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();

            EditorGUILayout.BeginVertical(GUILayout.MaxWidth(position.width * 0.72f));

            // Sender label + timestamp
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            GUILayout.Label(msg.Timestamp, timestampStyle);
            GUILayout.Space(4);
            GUIStyle senderStyle = new GUIStyle(EditorStyles.miniLabel)
            {
                fontStyle = FontStyle.Bold,
                normal = { textColor = EditorGUIUtility.isProSkin ? new Color(0.55f, 0.75f, 1.0f) : new Color(0.2f, 0.4f, 0.8f) }
            };
            GUILayout.Label("You \U0001F464", senderStyle);
            EditorGUILayout.EndHorizontal();

            // Bubble
            EditorGUILayout.BeginVertical(userBubbleStyle);
            GUILayout.Label(msg.Text, userLabelStyle);
            EditorGUILayout.EndVertical();

            EditorGUILayout.EndVertical();

            GUILayout.Space(4);
            EditorGUILayout.EndHorizontal();
        }

        private void DrawAgentMessage(ChatMessage msg)
        {
            EditorGUILayout.BeginHorizontal();
            GUILayout.Space(4);

            EditorGUILayout.BeginVertical(GUILayout.MaxWidth(position.width * 0.72f));

            // Sender label + timestamp
            EditorGUILayout.BeginHorizontal();
            GUIStyle senderStyle = new GUIStyle(EditorStyles.miniLabel)
            {
                fontStyle = FontStyle.Bold,
                normal = { textColor = EditorGUIUtility.isProSkin ? new Color(0.45f, 0.85f, 0.55f) : new Color(0.15f, 0.55f, 0.30f) }
            };
            GUILayout.Label("\u2728 Agent", senderStyle);
            GUILayout.Space(4);
            GUILayout.Label(msg.Timestamp, timestampStyle);
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();

            // Bubble
            EditorGUILayout.BeginVertical(agentBubbleStyle);
            GUILayout.Label(msg.Text, agentLabelStyle);
            EditorGUILayout.EndVertical();

            EditorGUILayout.EndVertical();

            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();
        }

        #endregion

        #region Separator

        private void DrawSeparator()
        {
            Rect rect = EditorGUILayout.GetControlRect(false, 1);
            Color sepColor = EditorGUIUtility.isProSkin
                ? new Color(0.3f, 0.3f, 0.35f, 0.6f)
                : new Color(0.75f, 0.75f, 0.80f, 0.6f);
            EditorGUI.DrawRect(rect, sepColor);
        }

        #endregion

        #region Input Area

        private void DrawInputArea()
        {
            Rect inputAreaRect = EditorGUILayout.BeginVertical(inputAreaStyle);
            if (inputAreaBgTex != null)
            {
                GUI.DrawTexture(inputAreaRect, inputAreaBgTex, ScaleMode.StretchToFill);
            }

            EditorGUILayout.BeginHorizontal();

            // Handle Enter key to send
            bool enterPressed = Event.current.type == EventType.KeyDown
                && Event.current.keyCode == KeyCode.Return
                && !Event.current.shift
                && GUI.GetNameOfFocusedControl() == InputControlName;

            // Text input
            GUI.SetNextControlName(InputControlName);
            inputText = EditorGUILayout.TextArea(inputText, inputFieldStyle, GUILayout.MinHeight(32), GUILayout.MaxHeight(60), GUILayout.ExpandWidth(true));

            // Buttons column
            EditorGUILayout.BeginVertical(GUILayout.Width(68));

            // Send button
            bool sendClicked = GUILayout.Button("Send \u25B6", sendButtonStyle, GUILayout.Height(28), GUILayout.Width(68));

            GUILayout.Space(2);

            // Clear button
            bool clearClicked = GUILayout.Button("Clear", clearButtonStyle, GUILayout.Height(20), GUILayout.Width(68));

            EditorGUILayout.EndVertical();

            EditorGUILayout.EndHorizontal();

            EditorGUILayout.EndVertical();

            // Process send
            if ((sendClicked || enterPressed) && !string.IsNullOrWhiteSpace(inputText))
            {
                SendMessage(inputText.Trim());
                inputText = "";

                // Refocus the input field
                EditorGUI.FocusTextInControl(InputControlName);

                // Consume the Enter key event
                if (enterPressed)
                {
                    Event.current.Use();
                }

                Repaint();
            }

            // Process clear
            if (clearClicked && messages.Count > 0)
            {
                if (EditorUtility.DisplayDialog("Clear Chat", "Are you sure you want to clear all messages?", "Clear", "Cancel"))
                {
                    messages.Clear();
                    if (scriptManager != null && scriptManager.IsInitialized)
                    {
                        scriptManager.ClearHistory();
                    }
                    Repaint();
                }
            }
        }

        #endregion

        #region Send Logic

        private void SendMessage(string text)
        {
            string timestamp = DateTime.Now.ToString("HH:mm");

            // Add user message
            messages.Add(new ChatMessage { Text = text, IsUser = true, Timestamp = timestamp });

            // Get response from TS asynchronously
            if (scriptManager != null && scriptManager.IsInitialized)
            {
                isWaitingForResponse = true;
                shouldScrollToBottom = true;
                Repaint();

                scriptManager.SendMessageAsync(text, (response, isError) =>
                {
                    isWaitingForResponse = false;
                    messages.Add(new ChatMessage
                    {
                        Text = response,
                        IsUser = false,
                        Timestamp = DateTime.Now.ToString("HH:mm")
                    });
                    shouldScrollToBottom = true;
                    Repaint();
                });
            }
            else
            {
                messages.Add(new ChatMessage
                {
                    Text = "Agent not initialized. Please retry initialization.",
                    IsUser = false,
                    Timestamp = DateTime.Now.ToString("HH:mm")
                });
                shouldScrollToBottom = true;
            }
        }

        #endregion

        private void OnDestroy()
        {
            if (scriptManager != null)
            {
                scriptManager.Dispose();
                scriptManager = null;
            }

            // Clean up textures
            DestroyTexture(userBubbleTex);
            DestroyTexture(agentBubbleTex);
            DestroyTexture(headerBgTex);
            DestroyTexture(inputAreaBgTex);
            DestroyTexture(sendBtnNormalTex);
            DestroyTexture(sendBtnHoverTex);
            DestroyTexture(inputFieldBgTex);
            DestroyTexture(settingsBgTex);
        }

        private void DestroyTexture(Texture2D tex)
        {
            if (tex != null)
            {
                DestroyImmediate(tex);
            }
        }
    }
}
