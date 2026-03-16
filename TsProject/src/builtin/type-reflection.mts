/**
 * Builtin: Type Reflection Functions
 *
 * Progressive disclosure of C# type information:
 *   - listNamespaces()           – all namespaces in the runtime
 *   - listTypesInNamespace(ns)   – types (name + kind) under given namespaces
 *   - getTypeDetails(typeNames)  – full signatures (properties, methods, fields) for given types
 *
 * Backed by C# TypeReflectionBridge which uses System.Reflection with caching.
 */

// ---- Description for tool description ----

export const description = `
- **\`listNamespaces()\`** — List all C# namespaces available across all loaded assemblies.
  - Returns a parsed JSON object with a \`namespaces\` array of namespace name strings.
  - Results are cached after the first call.

- **\`listTypesInNamespace(namespaces)\`** — List all public types under one or more C# namespaces.
  - \`namespaces\` (string): Comma-separated namespace names, e.g. \`'UnityEngine,UnityEngine.UI'\`.
  - Returns a parsed JSON object with type name, full name, and kind for each type.
  - Does NOT return property/method details — use \`getTypeDetails\` for that.

- **\`getTypeDetails(typeNames)\`** — Get detailed information about one or more C# types.
  - \`typeNames\` (string): Comma-separated fully-qualified type names, e.g. \`'UnityEngine.Transform,UnityEngine.GameObject'\`.
  - Returns a parsed JSON object with all public properties, methods, fields, interfaces, base type, and enum values.
`.trim();

// ---- Function implementations (become globals in eval VM) ----

/**
 * List all C# namespaces found across all loaded assemblies in the Unity runtime.
 */
function listNamespaces(): any {
    const json = CS.LLMAgent.TypeReflectionBridge.GetAllNamespaces();
    return JSON.parse(json);
}

/**
 * List all public types (classes, structs, enums, interfaces, delegates)
 * under one or more C# namespaces.
 * @param namespaces Comma-separated namespace names, e.g. "UnityEngine,UnityEngine.UI"
 */
function listTypesInNamespace(namespaces: string): any {
    const json = CS.LLMAgent.TypeReflectionBridge.GetTypesInNamespaces(namespaces);
    return JSON.parse(json);
}

/**
 * Get detailed information about one or more C# types, including all public
 * properties, methods, fields, interfaces, base type, and enum values.
 * @param typeNames Comma-separated fully-qualified type names, e.g. "UnityEngine.Transform"
 */
function getTypeDetails(typeNames: string): any {
    const json = CS.LLMAgent.TypeReflectionBridge.GetTypeDetails(typeNames);
    return JSON.parse(json);
}

// Register as globals in the eval VM
(globalThis as any).listNamespaces = listNamespaces;
(globalThis as any).listTypesInNamespace = listTypesInNamespace;
(globalThis as any).getTypeDetails = getTypeDetails;
