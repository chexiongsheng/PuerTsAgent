using System;
using System.Collections;
using System.IO;
using UnityEngine;

namespace LLMAgent
{
    /// <summary>
    /// Screen capture bridge for TypeScript.
    /// Captures the current game view as a PNG image encoded in base64.
    /// Both Editor and Runtime use coroutine + WaitForEndOfFrame for reliable capture.
    /// If not in Play Mode (Editor only), falls back to Camera.Render approach.
    /// </summary>
    public static class ScreenCaptureBridge
    {
        /// <summary>
        /// Hidden MonoBehaviour singleton that drives coroutines for screen capture.
        /// </summary>
        private class ScreenCaptureRunner : MonoBehaviour
        {
            private static ScreenCaptureRunner _instance;

            public static ScreenCaptureRunner Instance
            {
                get
                {
                    if (_instance == null)
                    {
                        var go = new GameObject("[ScreenCaptureRunner]");
                        go.hideFlags = HideFlags.HideAndDontSave;
                        UnityEngine.Object.DontDestroyOnLoad(go);
                        _instance = go.AddComponent<ScreenCaptureRunner>();
                    }
                    return _instance;
                }
            }

            public void CaptureScreen(int maxWidth, int maxHeight, Action<string> onComplete)
            {
                StartCoroutine(CaptureCoroutine(maxWidth, maxHeight, onComplete));
            }

            private IEnumerator CaptureCoroutine(int maxWidth, int maxHeight, Action<string> onComplete)
            {
                // Wait until end of frame so the screen is fully rendered
                yield return new WaitForEndOfFrame();

                string result;
                try
                {
                    // Read screen pixels
                    int screenWidth = Screen.width;
                    int screenHeight = Screen.height;

                    var screenTex = new Texture2D(screenWidth, screenHeight, TextureFormat.RGB24, false);
                    screenTex.ReadPixels(new Rect(0, 0, screenWidth, screenHeight), 0, 0);
                    screenTex.Apply();

                    result = ProcessAndEncode(screenTex, screenWidth, screenHeight, maxWidth, maxHeight);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[ScreenCaptureBridge] Capture failed: {ex.Message}");
                    result = BuildErrorJson(ex.Message);
                }

                onComplete?.Invoke(result);
            }
        }

        /// <summary>
        /// Capture the current screen and return the result as a base64-encoded PNG via callback.
        /// </summary>
        /// <param name="maxWidth">Maximum width to resize to (0 = no resize)</param>
        /// <param name="maxHeight">Maximum height to resize to (0 = no resize)</param>
        /// <param name="callback">Callback invoked with JSON result string</param>
        public static void CaptureScreenAsync(int maxWidth, int maxHeight, Action<string> callback)
        {
            if (callback == null)
            {
                Debug.LogError("[ScreenCaptureBridge] Callback is null");
                return;
            }

            // If Application is playing, use coroutine-based approach (works in both Editor Play and Runtime)
            if (Application.isPlaying)
            {
                try
                {
                    ScreenCaptureRunner.Instance.CaptureScreen(maxWidth, maxHeight, callback);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[ScreenCaptureBridge] Coroutine capture failed: {ex.Message}");
                    callback.Invoke(BuildErrorJson(ex.Message));
                }
            }
            else
            {
                // Not in Play Mode - use Camera.Render to RenderTexture (synchronous fallback)
                try
                {
                    string result = CaptureViaCamera(maxWidth, maxHeight);
                    callback.Invoke(result);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[ScreenCaptureBridge] Camera capture failed: {ex.Message}");
                    callback.Invoke(BuildErrorJson(ex.Message));
                }
            }
        }

        /// <summary>
        /// Fallback capture when not in Play Mode: render from Camera.main to a RenderTexture.
        /// </summary>
        private static string CaptureViaCamera(int maxWidth, int maxHeight)
        {
            var cam = Camera.main;
            if (cam == null)
            {
                // Try to find any camera
                cam = UnityEngine.Object.FindObjectOfType<Camera>();
            }
            if (cam == null)
            {
                return BuildErrorJson("No camera found in scene. Cannot capture screen outside Play Mode.");
            }

            int captureWidth = maxWidth > 0 ? maxWidth : 512;
            int captureHeight = maxHeight > 0 ? maxHeight : 512;

            // Create a RenderTexture and render the camera into it
            RenderTexture rt = new RenderTexture(captureWidth, captureHeight, 24, RenderTextureFormat.ARGB32);
            rt.Create();

            RenderTexture previous = cam.targetTexture;
            RenderTexture previousActive = RenderTexture.active;

            cam.targetTexture = rt;
            cam.Render();

            RenderTexture.active = rt;
            Texture2D tex = new Texture2D(captureWidth, captureHeight, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, captureWidth, captureHeight), 0, 0);
            tex.Apply();

            // Restore camera state
            cam.targetTexture = previous;
            RenderTexture.active = previousActive;
            rt.Release();
            UnityEngine.Object.DestroyImmediate(rt);

            byte[] pngBytes = tex.EncodeToPNG();
/*
#if UNITY_EDITOR
            // Save a debug copy to disk for inspection
            try
            {
                string debugPath = Path.Combine(Application.dataPath, "..", "debug_screenshot.png");
                File.WriteAllBytes(debugPath, pngBytes);
                Debug.Log($"[ScreenCaptureBridge] Debug screenshot saved to: {Path.GetFullPath(debugPath)} ({captureWidth}x{captureHeight})");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[ScreenCaptureBridge] Failed to save debug screenshot: {ex.Message}");
            }
#endif
*/
            Debug.Log($"[ScreenCaptureBridge] Processed screenshot: {captureWidth}x{captureHeight}, {pngBytes.Length} bytes");
            string base64 = Convert.ToBase64String(pngBytes);
            UnityEngine.Object.DestroyImmediate(tex);

            return BuildSuccessJson(base64, captureWidth, captureHeight);
        }

        /// <summary>
        /// Process a captured Texture2D: optionally resize, encode to PNG, and return JSON.
        /// </summary>
        private static string ProcessAndEncode(Texture2D screenTex, int screenWidth, int screenHeight, int maxWidth, int maxHeight)
        {
            int finalWidth = screenWidth;
            int finalHeight = screenHeight;

            Texture2D finalTex = screenTex;
            if (maxWidth > 0 && maxHeight > 0 && (screenWidth > maxWidth || screenHeight > maxHeight))
            {
                float scale = Mathf.Min((float)maxWidth / screenWidth, (float)maxHeight / screenHeight);
                finalWidth = Mathf.Max(1, Mathf.RoundToInt(screenWidth * scale));
                finalHeight = Mathf.Max(1, Mathf.RoundToInt(screenHeight * scale));

                finalTex = ResizeTexture(screenTex, finalWidth, finalHeight);
                UnityEngine.Object.Destroy(screenTex);
            }

            byte[] pngBytes = finalTex.EncodeToPNG();


#if UNITY_EDITOR
            // Save a debug copy to disk for inspection
            try
            {
                string debugPath = Path.Combine(Application.dataPath, "..", "debug_screenshot.png");
                File.WriteAllBytes(debugPath, pngBytes);
                Debug.Log($"[ScreenCaptureBridge] Debug screenshot saved to: {Path.GetFullPath(debugPath)} ({finalWidth}x{finalHeight})");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[ScreenCaptureBridge] Failed to save debug screenshot: {ex.Message}");
            }
#endif

            /*
            // TEMP: Override with apple.png for testing vision capability
            string testImagePath = Path.Combine(Application.dataPath, "..", "apple.png");
            if (File.Exists(testImagePath))
            {
                byte[] testBytes = File.ReadAllBytes(testImagePath);
                // Load into a temporary Texture2D to get actual dimensions
                var tmpTex = new Texture2D(2, 2);
                tmpTex.LoadImage(testBytes);
                int testWidth = tmpTex.width;
                int testHeight = tmpTex.height;
                UnityEngine.Object.Destroy(tmpTex);

                Debug.Log($"[ScreenCaptureBridge] TEMP: Returning apple.png instead of screenshot ({testWidth}x{testHeight}, {testBytes.Length} bytes)");
                string testBase64 = Convert.ToBase64String(testBytes);
                UnityEngine.Object.Destroy(finalTex);
                return BuildSuccessJson(testBase64, testWidth, testHeight);
            }
            else
            {
                Debug.LogWarning($"[ScreenCaptureBridge] TEMP: apple.png not found at {testImagePath}, falling back to real screenshot");
            }
            */

            string base64 = Convert.ToBase64String(pngBytes);
            Debug.Log($"[ScreenCaptureBridge] Processed screenshot: {finalWidth}x{finalHeight}, {pngBytes.Length} bytes");
            UnityEngine.Object.Destroy(finalTex);

            return BuildSuccessJson(base64, finalWidth, finalHeight);
        }

        /// <summary>
        /// Resize a texture using GPU bilinear filtering via RenderTexture + Blit.
        /// </summary>
        private static Texture2D ResizeTexture(Texture2D source, int targetWidth, int targetHeight)
        {
            RenderTexture rt = RenderTexture.GetTemporary(targetWidth, targetHeight, 0, RenderTextureFormat.Default, RenderTextureReadWrite.sRGB);
            rt.filterMode = FilterMode.Bilinear;

            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = rt;

            Graphics.Blit(source, rt);

            Texture2D result = new Texture2D(targetWidth, targetHeight, TextureFormat.RGB24, false);
            result.ReadPixels(new Rect(0, 0, targetWidth, targetHeight), 0, 0);
            result.Apply();

            RenderTexture.active = previous;
            RenderTexture.ReleaseTemporary(rt);

            return result;
        }

        private static string BuildSuccessJson(string base64, int width, int height)
        {
            return $"{{\"success\":true,\"width\":{width},\"height\":{height},\"base64\":\"{base64}\"}}";
        }

        private static string BuildErrorJson(string errorMessage)
        {
            string escaped = EscapeJson(errorMessage);
            return $"{{\"success\":false,\"error\":\"{escaped}\"}}";
        }

        private static string EscapeJson(string str)
        {
            if (string.IsNullOrEmpty(str)) return "";

            var sb = new System.Text.StringBuilder(str.Length);
            foreach (char c in str)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            sb.Append($"\\u{(int)c:x4}");
                        else
                            sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }
    }
}
