/**
 * Screenshot Tool for AI Agent
 * Allows the LLM to capture and analyze the Unity game screen.
 */
import { tool } from 'ai';
import { z } from 'zod';

/**
 * Create screenshot tools that the agent can use to capture the Unity screen.
 */
export function createScreenshotTools() {
    return {
        /**
         * Capture the current Unity game screen.
         */
        captureScreenshot: tool({
            description:
                'Capture a screenshot of the current Unity game view. ' +
                'Returns a base64-encoded PNG image of the screen. ' +
                'Use this tool when you need to see what is currently displayed in the game, ' +
                'diagnose visual issues, check UI layout, or analyze the game state visually. ' +
                'The image will be resized to fit within the specified max dimensions to reduce token usage.',
            parameters: z.object({
                maxWidth: z
                    .number()
                    .int()
                    .min(64)
                    .max(1920)
                    .default(512)
                    .describe(
                        'Maximum width of the captured image in pixels (64-1920, default 512). ' +
                        'Lower values reduce token cost but also reduce detail.'
                    ),
                maxHeight: z
                    .number()
                    .int()
                    .min(64)
                    .max(1080)
                    .default(512)
                    .describe(
                        'Maximum height of the captured image in pixels (64-1080, default 512). ' +
                        'Lower values reduce token cost but also reduce detail.'
                    ),
            }),
            execute: async ({ maxWidth, maxHeight }) => {
                try {
                    const resultJson = await captureScreenPromise(maxWidth, maxHeight);
                    const result = JSON.parse(resultJson);

                    if (!result.success) {
                        return {
                            success: false,
                            message: `Screenshot capture failed: ${result.error || 'Unknown error'}`,
                        };
                    }

                    return {
                        success: true,
                        message: `Screenshot captured successfully (${result.width}x${result.height}).`,
                        image: {
                            type: 'image' as const,
                            mimeType: 'image/png',
                            base64: result.base64,
                            width: result.width,
                            height: result.height,
                        },
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        message: `Screenshot capture failed: ${error.message || error}`,
                    };
                }
            },
        }),
    };
}

/**
 * Wrap the C# async callback into a Promise.
 */
function captureScreenPromise(maxWidth: number, maxHeight: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        try {
            CS.LLMAgent.ScreenCaptureBridge.CaptureScreenAsync(
                maxWidth,
                maxHeight,
                (resultJson: string) => {
                    resolve(resultJson);
                }
            );
        } catch (error: any) {
            reject(error);
        }
    });
}
