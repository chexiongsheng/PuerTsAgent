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
globalThis.sceneViewZoom = sceneViewZoom;
globalThis.sceneViewPan = sceneViewPan;
globalThis.sceneViewOrbit = sceneViewOrbit;
export {
  description
};
