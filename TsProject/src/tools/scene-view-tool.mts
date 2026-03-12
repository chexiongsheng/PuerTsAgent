/**
 * Scene View Navigation Tools for AI Agent
 * Allows the LLM to manipulate the Unity Editor Scene view camera:
 * - Zoom (forward/backward, like mouse scroll wheel)
 * - Pan (up/down/left/right, like middle-mouse drag)
 * - Orbit (up/down/left/right, like right-mouse drag)
 *
 * These tools help the AI adjust the Scene view angle to better inspect
 * objects and then take screenshots with captureSceneView.
 */
import { tool } from 'ai';
import { z } from 'zod';

/** Result shape from a scene view manipulation. */
interface ManipulationResult {
    success: boolean;
    operation?: string;
    direction?: string;
    amount?: number;
    description?: string;
    error?: string;
}

/**
 * Create scene view navigation tools that the agent can use to control the Scene view camera.
 */
export function createSceneViewNavigationTools() {
    return {
        /**
         * Zoom the Scene view camera forward or backward (like mouse scroll wheel).
         */
        sceneViewZoom: tool({
            description:
                'Zoom the Unity Scene view camera in or out (Editor only). ' +
                'This is equivalent to scrolling the mouse wheel in the Scene view. ' +
                'Use "forward" or "in" to zoom closer to the pivot point, ' +
                'and "backward" or "out" to zoom farther away. ' +
                'The amount controls the intensity (1 = normal step, 2 = double, etc.). ' +
                'Use this before captureSceneView to get a closer or wider view of objects.',
            inputSchema: z.object({
                direction: z
                    .enum(['forward', 'backward', 'in', 'out'])
                    .describe(
                        'Zoom direction. "forward"/"in" = zoom closer, "backward"/"out" = zoom farther.'
                    ),
                amount: z
                    .number()
                    .min(0.1)
                    .max(20)
                    .default(1)
                    .describe(
                        'Zoom intensity (0.1-20, default 1). ' +
                        'Higher values zoom more aggressively per step.'
                    ),
            }),
            execute: async ({ direction, amount }): Promise<string> => {
                try {
                    const resultJson = await manipulateSceneViewPromise('zoom', direction, amount);
                    const result: ManipulationResult = JSON.parse(resultJson);
                    if (!result.success) {
                        return `Zoom failed: ${result.error || 'Unknown error'}`;
                    }
                    return result.description || `Zoomed ${direction} successfully.`;
                } catch (error: any) {
                    return `Zoom failed: ${error.message || error}`;
                }
            },
        }),

        /**
         * Pan the Scene view camera up/down/left/right (like middle-mouse drag).
         */
        sceneViewPan: tool({
            description:
                'Pan (translate) the Unity Scene view camera up, down, left, or right (Editor only). ' +
                'This is equivalent to holding the middle mouse button and dragging in the Scene view. ' +
                'The camera pivot point moves in the specified direction relative to the current camera orientation. ' +
                'The amount controls how far to pan (1 = normal step, scaled to current zoom level). ' +
                'Use this before captureSceneView to center a specific object in the view.',
            inputSchema: z.object({
                direction: z
                    .enum(['up', 'down', 'left', 'right'])
                    .describe(
                        'Pan direction relative to the current camera view.'
                    ),
                amount: z
                    .number()
                    .min(0.1)
                    .max(50)
                    .default(1)
                    .describe(
                        'Pan distance multiplier (0.1-50, default 1). ' +
                        'Automatically scaled by current zoom level for consistent feel.'
                    ),
            }),
            execute: async ({ direction, amount }): Promise<string> => {
                try {
                    const resultJson = await manipulateSceneViewPromise('pan', direction, amount);
                    const result: ManipulationResult = JSON.parse(resultJson);
                    if (!result.success) {
                        return `Pan failed: ${result.error || 'Unknown error'}`;
                    }
                    return result.description || `Panned ${direction} successfully.`;
                } catch (error: any) {
                    return `Pan failed: ${error.message || error}`;
                }
            },
        }),

        /**
         * Orbit (rotate) the Scene view camera around the pivot point (like right-mouse drag).
         */
        sceneViewOrbit: tool({
            description:
                'Orbit (rotate) the Unity Scene view camera around its pivot point (Editor only). ' +
                'This is equivalent to holding the right mouse button and dragging in the Scene view. ' +
                '"up"/"down" rotates the camera pitch (looking up/down), ' +
                '"left"/"right" rotates the camera yaw (looking left/right). ' +
                'The amount controls rotation intensity (1 = ~15 degrees). ' +
                'Use this before captureSceneView to view objects from different angles.',
            inputSchema: z.object({
                direction: z
                    .enum(['up', 'down', 'left', 'right'])
                    .describe(
                        'Orbit direction. "up"/"down" = pitch, "left"/"right" = yaw.'
                    ),
                amount: z
                    .number()
                    .min(0.1)
                    .max(24)
                    .default(1)
                    .describe(
                        'Orbit intensity (0.1-24, default 1). ' +
                        'Each unit is approximately 15 degrees of rotation.'
                    ),
            }),
            execute: async ({ direction, amount }): Promise<string> => {
                try {
                    const resultJson = await manipulateSceneViewPromise('orbit', direction, amount);
                    const result: ManipulationResult = JSON.parse(resultJson);
                    if (!result.success) {
                        return `Orbit failed: ${result.error || 'Unknown error'}`;
                    }
                    return result.description || `Orbited ${direction} successfully.`;
                } catch (error: any) {
                    return `Orbit failed: ${error.message || error}`;
                }
            },
        }),
    };
}

/**
 * Wrap the C# ManipulateSceneView call into a Promise.
 */
function manipulateSceneViewPromise(operation: string, direction: string, amount: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        try {
            CS.LLMAgent.ScreenCaptureBridge.ManipulateSceneView(
                operation,
                direction,
                amount,
                (resultJson: string) => {
                    resolve(resultJson);
                }
            );
        } catch (error: any) {
            reject(error);
        }
    });
}
