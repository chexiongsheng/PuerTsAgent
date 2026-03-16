var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/builtin/scene-view.mts
var description = `
- **\`sceneViewZoom(direction, amount?)\`** \u2014 Zoom the Scene view camera in or out (like mouse scroll wheel).
  - \`direction\` (string): \`'forward'\` / \`'in'\` to zoom closer, \`'backward'\` / \`'out'\` to zoom farther.
  - \`amount\` (number, default 1): Zoom intensity (0.1\u201320).
  - Returns a Promise that resolves to the result description string.

- **\`sceneViewPan(direction, amount?)\`** \u2014 Pan (translate) the Scene view camera (like middle-mouse drag).
  - \`direction\` (string): \`'up'\`, \`'down'\`, \`'left'\`, or \`'right'\`.
  - \`amount\` (number, default 1): Pan distance multiplier (0.1\u201350), auto-scaled by zoom level.
  - Returns a Promise that resolves to the result description string.

- **\`sceneViewOrbit(direction, amount?)\`** \u2014 Orbit (rotate) the Scene view camera around its pivot (like right-mouse drag).
  - \`direction\` (string): \`'up'\` / \`'down'\` for pitch, \`'left'\` / \`'right'\` for yaw.
  - \`amount\` (number, default 1): Orbit intensity (0.1\u201324), each unit \u2248 15 degrees.
  - Returns a Promise that resolves to the result description string.

- **\`getSceneViewState()\`** \u2014 Get the current Scene view camera state (synchronous).
  - Returns an object: \`{ success: boolean, pivot: {x,y,z}, rotation: {x,y,z,w}, eulerAngles: {x,y,z}, size: number, orthographic: boolean }\`.
  - Access properties directly, e.g. \`getSceneViewState().pivot.x\`.
  - Use this to check the current camera position/rotation/zoom before or after manipulation.

- **\`setSceneViewCamera(pivot?, rotation?, size?)\`** \u2014 Directly set the Scene view camera state (synchronous).
  - \`pivot\` (object, optional): \`{x, y, z}\` \u2014 the world-space point the camera orbits around.
  - \`rotation\` (object, optional): \`{x, y, z}\` \u2014 euler angles in degrees.
  - \`size\` (number, optional): Zoom level (positive float). 0 or omitted = keep current.
  - Returns an object: \`{ success, pivot, eulerAngles, size }\` with the resulting state.
  - Much more efficient than multiple zoom/pan/orbit calls when you know the target pose.

- **\`focusSceneViewOn(gameObjectName)\`** \u2014 Frame a GameObject in the Scene view (like pressing F in the Editor).
  - \`gameObjectName\` (string): Name of the GameObject to focus on (uses GameObject.Find).
  - Automatically selects the object and adjusts the Scene view to frame it.
  - Returns an object: \`{ success, focused, pivot, size }\`.

- **\`getGameObjectHierarchy(name?, depth?)\`** \u2014 Get the hierarchy of GameObjects as a tree structure.
  - \`name\` (string, optional): Name of a root GameObject. Empty/omitted = all root objects in the active scene.
  - \`depth\` (number, optional, default 0): Max traversal depth. 0 = unlimited.
  - Returns an object: \`{ success, hierarchy: [...] }\` where each node has \`{ name, active, components, children? }\`.
  - When depth is limited, nodes beyond the limit show \`childCount\` instead of \`children\`.

- **\`selectGameObject(name)\`** \u2014 Select a GameObject in the Unity Editor (highlights it in Hierarchy & Scene view).
  - \`name\` (string): Name of the GameObject to select (uses GameObject.Find).
  - Returns an object: \`{ success, selected }\`.

- **\`saveScene()\`** \u2014 Save the current active scene to disk.
  - Returns an object: \`{ success, scene, path }\` on success.
`.trim();
function manipulateSceneViewPromise(operation, direction, amount) {
  return new Promise((resolve, reject) => {
    try {
      CS.LLMAgent.ScreenCaptureBridge.ManipulateSceneView(
        operation,
        direction,
        amount,
        (resultJson) => {
          resolve(resultJson);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}
__name(manipulateSceneViewPromise, "manipulateSceneViewPromise");
async function doManipulate(operation, direction, amount) {
  const resultJson = await manipulateSceneViewPromise(operation, direction, amount);
  const result = JSON.parse(resultJson);
  if (!result.success) {
    return `${operation} failed: ${result.error || "Unknown error"}`;
  }
  return result.description || `${operation} ${direction} (amount=${amount}) succeeded.`;
}
__name(doManipulate, "doManipulate");
async function sceneViewZoom(direction, amount = 1) {
  return doManipulate("zoom", direction, amount);
}
__name(sceneViewZoom, "sceneViewZoom");
async function sceneViewPan(direction, amount = 1) {
  return doManipulate("pan", direction, amount);
}
__name(sceneViewPan, "sceneViewPan");
async function sceneViewOrbit(direction, amount = 1) {
  return doManipulate("orbit", direction, amount);
}
__name(sceneViewOrbit, "sceneViewOrbit");
function getSceneViewState() {
  const json = CS.LLMAgent.ScreenCaptureBridge.GetSceneViewState();
  return JSON.parse(json);
}
__name(getSceneViewState, "getSceneViewState");
function setSceneViewCamera(pivot, rotation, size) {
  const json = CS.LLMAgent.ScreenCaptureBridge.SetSceneViewCamera(
    pivot?.x ?? 0,
    pivot?.y ?? 0,
    pivot?.z ?? 0,
    !!pivot,
    rotation?.x ?? 0,
    rotation?.y ?? 0,
    rotation?.z ?? 0,
    !!rotation,
    size ?? 0
  );
  return JSON.parse(json);
}
__name(setSceneViewCamera, "setSceneViewCamera");
function focusSceneViewOn(gameObjectName) {
  const json = CS.LLMAgent.ScreenCaptureBridge.FocusSceneViewOn(gameObjectName);
  return JSON.parse(json);
}
__name(focusSceneViewOn, "focusSceneViewOn");
function getGameObjectHierarchy(name, depth) {
  const json = CS.LLMAgent.ScreenCaptureBridge.GetGameObjectHierarchy(name ?? "", depth ?? 0);
  return JSON.parse(json);
}
__name(getGameObjectHierarchy, "getGameObjectHierarchy");
function selectGameObject(name) {
  const json = CS.LLMAgent.ScreenCaptureBridge.SelectGameObject(name);
  return JSON.parse(json);
}
__name(selectGameObject, "selectGameObject");
function saveScene() {
  const json = CS.LLMAgent.ScreenCaptureBridge.SaveScene();
  return JSON.parse(json);
}
__name(saveScene, "saveScene");
globalThis.sceneViewZoom = sceneViewZoom;
globalThis.sceneViewPan = sceneViewPan;
globalThis.sceneViewOrbit = sceneViewOrbit;
globalThis.getSceneViewState = getSceneViewState;
globalThis.setSceneViewCamera = setSceneViewCamera;
globalThis.focusSceneViewOn = focusSceneViewOn;
globalThis.getGameObjectHierarchy = getGameObjectHierarchy;
globalThis.selectGameObject = selectGameObject;
globalThis.saveScene = saveScene;
export {
  description
};
