/**
 * Builtin: Unity Log Functions
 *
 * Provides helper functions to access Unity console logs from the eval VM.
 * These functions are injected as globals when the eval VM is created.
 */

// ---- Description for SYSTEM_PROMPT ----

export const description = `
- **\`getUnityLogs(count?, logType?)\`** — Get recent Unity console logs.
  - \`count\` (number, default 20): Number of log entries to retrieve (1-50).
  - \`logType\` (string, default \`'all'\`): Filter by type — \`'all'\`, \`'error'\`, \`'warning'\`, or \`'log'\`.
  - Returns an array of log entry objects: \`{ timestamp, type, message, stackTrace? }\`.

- **\`getUnityLogSummary()\`** — Get a summary count of Unity logs by type.
  - Returns: \`{ log: number, warning: number, error: number, total: number }\`.
`.trim();

// ---- Function implementations (become globals in eval VM) ----

interface LogEntry {
    timestamp: string;
    type: string;
    message: string;
    stackTrace?: string;
}

interface LogSummary {
    log: number;
    warning: number;
    error: number;
    total: number;
}

/**
 * Get recent Unity console logs.
 * @param count Number of log entries to retrieve (default 20, range 1-50)
 * @param logType Filter by type: 'all', 'error', 'warning', or 'log' (default 'all')
 */
function getUnityLogs(count: number = 20, logType: string = 'all'): LogEntry[] {
    const logsJson = CS.LLMAgent.UnityLogBridge.GetRecentLogs(count, logType);
    return JSON.parse(logsJson);
}

/**
 * Get a summary count of Unity logs by type.
 */
function getUnityLogSummary(): LogSummary {
    const summaryJson = CS.LLMAgent.UnityLogBridge.GetLogSummary();
    return JSON.parse(summaryJson);
}

// Make functions available on globalThis so they persist as globals in the eval VM.
// (In IIFE output, local declarations are scoped; we need explicit global assignment.)
(globalThis as any).getUnityLogs = getUnityLogs;
(globalThis as any).getUnityLogSummary = getUnityLogSummary;
