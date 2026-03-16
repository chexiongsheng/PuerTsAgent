var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/builtin/unity-log.mts
var description = `
- **\`getUnityLogs(count?, logType?)\`** \u2014 Get recent Unity console logs.
  - \`count\` (number, default 20): Number of log entries to retrieve (1-50).
  - \`logType\` (string, default \`'all'\`): Filter by type \u2014 \`'all'\`, \`'error'\`, \`'warning'\`, or \`'log'\`.
  - Returns an array of log entry objects: \`{ timestamp, type, message, stackTrace? }\`.

- **\`getUnityLogSummary()\`** \u2014 Get a summary count of Unity logs by type.
  - Returns: \`{ log: number, warning: number, error: number, total: number }\`.
`.trim();
function getUnityLogs(count = 20, logType = "all") {
  const logsJson = CS.LLMAgent.UnityLogBridge.GetRecentLogs(count, logType);
  return JSON.parse(logsJson);
}
__name(getUnityLogs, "getUnityLogs");
function getUnityLogSummary() {
  const summaryJson = CS.LLMAgent.UnityLogBridge.GetLogSummary();
  return JSON.parse(summaryJson);
}
__name(getUnityLogSummary, "getUnityLogSummary");
globalThis.getUnityLogs = getUnityLogs;
globalThis.getUnityLogSummary = getUnityLogSummary;
export {
  description
};
