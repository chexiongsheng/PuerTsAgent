/**
 * Builtin: Scene View & Scene Manipulation Functions
 *
 * Scene view camera control:
 *   - sceneViewZoom / sceneViewPan / sceneViewOrbit  – incremental camera manipulation
 *   - setSceneViewCamera(pivot, rotation, size)      – direct camera placement
 *   - focusSceneViewOn(name)                         – frame a GameObject (like pressing F)
 *   - getSceneViewState()                            – query current camera state
 *
 * Scene hierarchy & editing:
 *   - getGameObjectHierarchy(name?, depth?)           – tree-structured hierarchy dump
 *   - selectGameObject(name)                          – select in Editor
 *   - saveScene()                                     – save current scene to disk
 *
 * Backed by C# ScreenCaptureBridge.
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

- **\`setSceneViewCamera(pivot?, rotation?, size?)\`** — Directly set the Scene view camera state (synchronous).
  - \`pivot\` (object, optional): \`{x, y, z}\` — the world-space point the camera orbits around.
  - \`rotation\` (object, optional): \`{x, y, z}\` — euler angles in degrees.
  - \`size\` (number, optional): Zoom level (positive float). 0 or omitted = keep current.
  - Returns an object: \`{ success, pivot, eulerAngles, size }\` with the resulting state.
  - Much more efficient than multiple zoom/pan/orbit calls when you know the target pose.

- **\`focusSceneViewOn(gameObjectName)\`** — Frame a GameObject in the Scene view (like pressing F in the Editor).
  - \`gameObjectName\` (string): Name of the GameObject to focus on (uses GameObject.Find).
  - Automatically selects the object and adjusts the Scene view to frame it.
  - Returns an object: \`{ success, focused, pivot, size }\`.

- **\`getGameObjectHierarchy(name?, depth?)\`** — Get the hierarchy of GameObjects as a tree structure.
  - \`name\` (string, optional): Name of a root GameObject. Empty/omitted = all root objects in the active scene.
  - \`depth\` (number, optional, default 0): Max traversal depth. 0 = unlimited.
  - Returns an object: \`{ success, hierarchy: [...] }\` where each node has \`{ name, active, components, children? }\`.
  - When depth is limited, nodes beyond the limit show \`childCount\` instead of \`children\`.

- **\`selectGameObject(name)\`** — Select a GameObject in the Unity Editor (highlights it in Hierarchy & Scene view).
  - \`name\` (string): Name of the GameObject to select (uses GameObject.Find).
  - Returns an object: \`{ success, selected }\`.

- **\`saveScene()\`** — Save the current active scene to disk.
  - Returns an object: \`{ success, scene, path }\` on success.
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

// ---- New functions: direct camera placement, hierarchy, selection, save ----

interface Vector3Like {
    x: number;
    y: number;
    z: number;
}

/**
 * Directly set the Scene view camera position, rotation, and zoom.
 * @param pivot  World-space pivot point {x,y,z} (optional)
 * @param rotation Euler angles {x,y,z} in degrees (optional)
 * @param size Zoom level (optional, 0 = keep current)
 */
function setSceneViewCamera(
    pivot?: Vector3Like,
    rotation?: Vector3Like,
    size?: number
): any {
    const json = CS.LLMAgent.ScreenCaptureBridge.SetSceneViewCamera(
        pivot?.x ?? 0, pivot?.y ?? 0, pivot?.z ?? 0, !!pivot,
        rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0, !!rotation,
        size ?? 0
    );
    return JSON.parse(json);
}

/**
 * Focus the Scene view on a specific GameObject (like pressing F in the Editor).
 * @param gameObjectName Name of the GameObject to focus on
 */
function focusSceneViewOn(gameObjectName: string): any {
    const json = CS.LLMAgent.ScreenCaptureBridge.FocusSceneViewOn(gameObjectName);
    return JSON.parse(json);
}

/**
 * Get the hierarchy of GameObjects as a tree structure.
 * @param name Root GameObject name (empty = all roots in active scene)
 * @param depth Max traversal depth (0 = unlimited)
 */
function getGameObjectHierarchy(name?: string, depth?: number): any {
    const json = CS.LLMAgent.ScreenCaptureBridge.GetGameObjectHierarchy(name ?? '', depth ?? 0);
    return JSON.parse(json);
}

/**
 * Select a GameObject in the Unity Editor.
 * @param name Name of the GameObject to select
 */
function selectGameObject(name: string): any {
    const json = CS.LLMAgent.ScreenCaptureBridge.SelectGameObject(name);
    return JSON.parse(json);
}

/**
 * Save the current active scene to disk.
 */
function saveScene(): any {
    const json = CS.LLMAgent.ScreenCaptureBridge.SaveScene();
    return JSON.parse(json);
}

// Register as globals in the eval VM
(globalThis as any).sceneViewZoom = sceneViewZoom;
(globalThis as any).sceneViewPan = sceneViewPan;
(globalThis as any).sceneViewOrbit = sceneViewOrbit;
(globalThis as any).getSceneViewState = getSceneViewState;
(globalThis as any).setSceneViewCamera = setSceneViewCamera;
(globalThis as any).focusSceneViewOn = focusSceneViewOn;
(globalThis as any).getGameObjectHierarchy = getGameObjectHierarchy;
(globalThis as any).selectGameObject = selectGameObject;
(globalThis as any).saveScene = saveScene;
