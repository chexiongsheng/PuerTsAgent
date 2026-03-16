/**
 * Builtin: Scene View Navigation Functions
 *
 * Allows AI code to manipulate the Unity Editor Scene view camera:
 *   - sceneViewZoom(direction, amount?)   – zoom forward/backward
 *   - sceneViewPan(direction, amount?)    – pan up/down/left/right
 *   - sceneViewOrbit(direction, amount?)  – orbit up/down/left/right
 *
 * Backed by C# ScreenCaptureBridge.ManipulateSceneView.
 */

// ---- Description for tool description ----

export const description = `
- **\`sceneViewZoom(direction, amount?)\`** — Zoom the Scene view camera in or out (like mouse scroll wheel).
  - \`direction\` (string): \`'forward'\` / \`'in'\` to zoom closer, \`'backward'\` / \`'out'\` to zoom farther.
  - \`amount\` (number, default 1): Zoom intensity (0.1–20).
  - Returns a Promise that resolves to the result description string.

- **\`sceneViewPan(direction, amount?)\`** — Pan (translate) the Scene view camera (like middle-mouse drag).
  - \`direction\` (string): \`'up'\`, \`'down'\`, \`'left'\`, or \`'right'\`.
  - \`amount\` (number, default 1): Pan distance multiplier (0.1–50), auto-scaled by zoom level.
  - Returns a Promise that resolves to the result description string.

- **\`sceneViewOrbit(direction, amount?)\`** — Orbit (rotate) the Scene view camera around its pivot (like right-mouse drag).
  - \`direction\` (string): \`'up'\` / \`'down'\` for pitch, \`'left'\` / \`'right'\` for yaw.
  - \`amount\` (number, default 1): Orbit intensity (0.1–24), each unit ≈ 15 degrees.
  - Returns a Promise that resolves to the result description string.

- **\`getSceneViewState()\`** — Get the current Scene view camera state (synchronous).
  - Returns an object: \`{ success: boolean, pivot: {x,y,z}, rotation: {x,y,z,w}, eulerAngles: {x,y,z}, size: number, orthographic: boolean }\`.
  - Access properties directly, e.g. \`getSceneViewState().pivot.x\`.
  - Use this to check the current camera position/rotation/zoom before or after manipulation.
`.trim();

// ---- Helper ----

interface ManipulationResult {
    success: boolean;
    operation?: string;
    direction?: string;
    amount?: number;
    description?: string;
    error?: string;
}

/**
 * Wrap the C# ManipulateSceneView callback into a Promise.
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

/**
 * Execute a scene view manipulation and return a friendly result string.
 */
async function doManipulate(operation: string, direction: string, amount: number): Promise<string> {
    const resultJson = await manipulateSceneViewPromise(operation, direction, amount);
    const result: ManipulationResult = JSON.parse(resultJson);
    if (!result.success) {
        return `${operation} failed: ${result.error || 'Unknown error'}`;
    }
    return result.description || `${operation} ${direction} (amount=${amount}) succeeded.`;
}

// ---- Function implementations (become globals in eval VM) ----

/**
 * Zoom the Scene view camera forward or backward.
 * @param direction 'forward' | 'in' | 'backward' | 'out'
 * @param amount Zoom intensity (0.1-20, default 1)
 */
async function sceneViewZoom(direction: string, amount: number = 1): Promise<string> {
    return doManipulate('zoom', direction, amount);
}

/**
 * Pan the Scene view camera up/down/left/right.
 * @param direction 'up' | 'down' | 'left' | 'right'
 * @param amount Pan distance multiplier (0.1-50, default 1)
 */
async function sceneViewPan(direction: string, amount: number = 1): Promise<string> {
    return doManipulate('pan', direction, amount);
}

/**
 * Orbit the Scene view camera around its pivot point.
 * @param direction 'up' | 'down' | 'left' | 'right'
 * @param amount Orbit intensity (0.1-24, default 1)
 */
async function sceneViewOrbit(direction: string, amount: number = 1): Promise<string> {
    return doManipulate('orbit', direction, amount);
}

interface SceneViewState {
    success: boolean;
    pivot?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    eulerAngles?: { x: number; y: number; z: number };
    size?: number;
    orthographic?: boolean;
    error?: string;
}

/**
 * Get the current Scene view camera state (pivot, rotation, size).
 * Returns a JS object that can be accessed directly.
 */
function getSceneViewState(): SceneViewState {
    const json = CS.LLMAgent.ScreenCaptureBridge.GetSceneViewState();
    return JSON.parse(json);
}

// Register as globals in the eval VM
(globalThis as any).sceneViewZoom = sceneViewZoom;
(globalThis as any).sceneViewPan = sceneViewPan;
(globalThis as any).sceneViewOrbit = sceneViewOrbit;
(globalThis as any).getSceneViewState = getSceneViewState;
