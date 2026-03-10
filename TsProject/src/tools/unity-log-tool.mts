/**
 * Unity Log Tool for AI Agent
 * Allows the LLM to retrieve Unity console logs via tool calls.
 */
import { tool } from 'ai';
import { z } from 'zod';

/**
 * Create Unity log tools that the agent can use to inspect Unity console output.
 */
export function createUnityLogTools() {
    return {
        /**
         * Get recent Unity console logs with optional filtering.
         */
        getUnityLogs: tool({
            description:
                'Get recent Unity console logs. Use this tool to inspect Unity Editor/Runtime logs, ' +
                'including errors, warnings, and normal log messages. ' +
                'Useful for debugging issues, checking for errors, or monitoring application state.',
            inputSchema: z.object({
                count: z
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .default(20)
                    .describe('Number of recent log entries to retrieve (1-50, default 20)'),
                logType: z
                    .enum(['all', 'error', 'warning', 'log'])
                    .default('all')
                    .describe(
                        'Filter by log type: "all" for all logs, "error" for errors and exceptions, ' +
                        '"warning" for warnings, "log" for normal messages'
                    ),
            }),
            execute: async ({ count, logType }) => {
                try {
                    const logsJson = CS.LLMAgent.UnityLogBridge.GetRecentLogs(count, logType);
                    const logs = JSON.parse(logsJson);

                    if (logs.length === 0) {
                        return {
                            success: true,
                            message: `No ${logType === 'all' ? '' : logType + ' '}logs found.`,
                            logs: [],
                        };
                    }

                    return {
                        success: true,
                        message: `Found ${logs.length} log entries.`,
                        logs,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        message: `Failed to retrieve logs: ${error.message || error}`,
                        logs: [],
                    };
                }
            },
        }),

        /**
         * Get a summary of Unity log counts by type.
         */
        getUnityLogSummary: tool({
            description:
                'Get a summary count of Unity console logs by type (errors, warnings, normal logs). ' +
                'Use this to quickly check if there are any errors or warnings without retrieving full log details.',
            inputSchema: z.object({}),
            execute: async () => {
                try {
                    const summaryJson = CS.LLMAgent.UnityLogBridge.GetLogSummary();
                    const summary = JSON.parse(summaryJson);

                    return {
                        success: true,
                        summary,
                        message:
                            `Log summary: ${summary.error} errors, ${summary.warning} warnings, ` +
                            `${summary.log} info messages (${summary.total} total)`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        summary: null,
                        message: `Failed to retrieve log summary: ${error.message || error}`,
                    };
                }
            },
        }),
    };
}
