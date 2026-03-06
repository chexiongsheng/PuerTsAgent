using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using UnityEngine;

namespace LLMAgent.Editor
{
    /// <summary>
    /// HTTP bridge for TypeScript fetch polyfill.
    /// Called from TS side via CS.LLMAgent.Editor.HttpBridge.SendRequest().
    /// Uses System.Net.Http.HttpClient for synchronous HTTP requests.
    /// </summary>
    public static class HttpBridge
    {
        private static readonly HttpClient client = new HttpClient();

        static HttpBridge()
        {
            // Set a reasonable timeout
            client.Timeout = TimeSpan.FromSeconds(120);
        }

        /// <summary>
        /// Send an HTTP request synchronously and return a JSON-encoded response.
        /// Called from TypeScript fetch polyfill.
        /// </summary>
        /// <param name="url">Request URL</param>
        /// <param name="method">HTTP method (GET, POST, etc.)</param>
        /// <param name="headersJson">JSON-encoded headers object</param>
        /// <param name="body">Request body (for POST/PUT/PATCH)</param>
        /// <returns>JSON string: { "status": int, "statusText": string, "headers": {}, "body": string }</returns>
        public static string SendRequest(string url, string method, string headersJson, string body)
        {
            try
            {
                var request = new HttpRequestMessage(new HttpMethod(method), url);

                // Parse and set headers
                if (!string.IsNullOrEmpty(headersJson) && headersJson != "{}")
                {
                    var headers = JsonUtility.FromJson<HeadersWrapper>(
                        WrapHeadersForUnityJson(headersJson)
                    );

                    // Since Unity's JsonUtility is limited, parse manually
                    SetRequestHeaders(request, headersJson);
                }

                // Set body for methods that support it
                if (!string.IsNullOrEmpty(body) && (method == "POST" || method == "PUT" || method == "PATCH"))
                {
                    string contentType = "application/json";
                    // Try to extract content-type from headers
                    var parsedHeaders = ParseHeadersJson(headersJson);
                    if (parsedHeaders.TryGetValue("content-type", out string ct))
                    {
                        contentType = ct;
                    }
                    request.Content = new StringContent(body, Encoding.UTF8, contentType);
                }

                // Send request synchronously
                var response = client.SendAsync(request).GetAwaiter().GetResult();

                // Read response body
                string responseBody = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();

                // Build response headers
                var responseHeaders = new Dictionary<string, string>();
                foreach (var header in response.Headers)
                {
                    responseHeaders[header.Key.ToLower()] = string.Join(", ", header.Value);
                }
                if (response.Content?.Headers != null)
                {
                    foreach (var header in response.Content.Headers)
                    {
                        responseHeaders[header.Key.ToLower()] = string.Join(", ", header.Value);
                    }
                }

                // Build response JSON
                var sb = new StringBuilder();
                sb.Append("{");
                sb.Append($"\"status\":{(int)response.StatusCode},");
                sb.Append($"\"statusText\":\"{EscapeJsonString(response.ReasonPhrase ?? "")}\",");
                sb.Append("\"headers\":{");

                bool first = true;
                foreach (var kv in responseHeaders)
                {
                    if (!first) sb.Append(",");
                    sb.Append($"\"{EscapeJsonString(kv.Key)}\":\"{EscapeJsonString(kv.Value)}\"");
                    first = false;
                }

                sb.Append("},");
                sb.Append($"\"body\":{ToJsonStringLiteral(responseBody)}");
                sb.Append("}");

                return sb.ToString();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[HttpBridge] Request failed: {ex.Message}");

                // Return error response
                return $"{{\"status\":0,\"statusText\":\"{EscapeJsonString(ex.Message)}\",\"headers\":{{}},\"body\":\"\"}}";
            }
        }

        /// <summary>
        /// Parse a JSON headers string into a dictionary.
        /// Simple parser for {"key":"value",...} format.
        /// </summary>
        private static Dictionary<string, string> ParseHeadersJson(string json)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrEmpty(json) || json == "{}")
                return result;

            try
            {
                // Simple JSON object parser for flat key-value pairs
                json = json.Trim();
                if (json.StartsWith("{")) json = json.Substring(1);
                if (json.EndsWith("}")) json = json.Substring(0, json.Length - 1);

                int i = 0;
                while (i < json.Length)
                {
                    // Skip whitespace and commas
                    while (i < json.Length && (json[i] == ' ' || json[i] == ',' || json[i] == '\n' || json[i] == '\r' || json[i] == '\t'))
                        i++;

                    if (i >= json.Length) break;

                    // Parse key
                    string key = ParseJsonString(json, ref i);
                    if (key == null) break;

                    // Skip colon
                    while (i < json.Length && (json[i] == ' ' || json[i] == ':'))
                        i++;

                    // Parse value
                    string value = ParseJsonString(json, ref i);
                    if (value == null) break;

                    result[key] = value;
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[HttpBridge] Failed to parse headers JSON: {ex.Message}");
            }

            return result;
        }

        private static string ParseJsonString(string json, ref int i)
        {
            if (i >= json.Length || json[i] != '"')
                return null;

            i++; // skip opening quote
            var sb = new StringBuilder();

            while (i < json.Length)
            {
                if (json[i] == '\\' && i + 1 < json.Length)
                {
                    i++;
                    switch (json[i])
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        default: sb.Append(json[i]); break;
                    }
                }
                else if (json[i] == '"')
                {
                    i++; // skip closing quote
                    return sb.ToString();
                }
                else
                {
                    sb.Append(json[i]);
                }
                i++;
            }

            return sb.ToString();
        }

        private static void SetRequestHeaders(HttpRequestMessage request, string headersJson)
        {
            var headers = ParseHeadersJson(headersJson);
            foreach (var kv in headers)
            {
                string key = kv.Key.ToLower();

                // Content headers must be set on Content, not on request.Headers
                if (key == "content-type" || key == "content-length" || key == "content-encoding")
                    continue;

                try
                {
                    request.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
                }
                catch (Exception)
                {
                    // Ignore invalid headers
                }
            }
        }

        private static string EscapeJsonString(string str)
        {
            if (string.IsNullOrEmpty(str)) return "";

            var sb = new StringBuilder(str.Length);
            foreach (char c in str)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
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

        /// <summary>
        /// Convert a string to a JSON string literal (with quotes and escaping).
        /// </summary>
        private static string ToJsonStringLiteral(string str)
        {
            if (str == null) return "\"\"";
            return $"\"{EscapeJsonString(str)}\"";
        }

        private static string WrapHeadersForUnityJson(string json)
        {
            return $"{{\"data\":{json}}}";
        }

        [Serializable]
        private class HeadersWrapper
        {
            public string data;
        }
    }
}
