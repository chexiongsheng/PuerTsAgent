var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/builtin/type-reflection.mts
var summary = `**type-reflection** \u2014 C# type introspection via reflection.
Functions: \`listNamespaces\`, \`listTypesInNamespace\`, \`getTypeDetails\`.
Use \`await import('LLMAgent/builtin/type-reflection.mjs')\` to access. **You MUST read \`.description\` before first use to get correct parameter signatures; wrong arguments will throw an error.**`;
var description = `
- **\`listNamespaces()\`** \u2014 List all C# namespaces available across all loaded assemblies.
  - Returns a parsed JSON object with a \`namespaces\` array of namespace name strings.
  - Results are cached after the first call.

- **\`listTypesInNamespace(namespaces)\`** \u2014 List all public types under one or more C# namespaces.
  - \`namespaces\` (string): Comma-separated namespace names, e.g. \`'UnityEngine,UnityEngine.UI'\`.
  - Returns a parsed JSON object with type name, full name, and kind for each type.
  - Does NOT return property/method details \u2014 use \`getTypeDetails\` for that.

- **\`getTypeDetails(typeNames)\`** \u2014 Get detailed information about one or more C# types.
  - \`typeNames\` (string): Comma-separated fully-qualified type names, e.g. \`'UnityEngine.Transform,UnityEngine.GameObject'\`.
  - Returns a parsed JSON object with all public properties, methods, fields, interfaces, base type, and enum values.
`.trim();
function listNamespaces() {
  const json = CS.LLMAgent.TypeReflectionBridge.GetAllNamespaces();
  return JSON.parse(json);
}
__name(listNamespaces, "listNamespaces");
function listTypesInNamespace(namespaces) {
  if (typeof namespaces !== "string" || namespaces.trim() === "") {
    throw new Error(`listTypesInNamespace: 'namespaces' must be a non-empty string (got ${JSON.stringify(namespaces)}). Read module.description for usage.`);
  }
  const json = CS.LLMAgent.TypeReflectionBridge.GetTypesInNamespaces(namespaces);
  return JSON.parse(json);
}
__name(listTypesInNamespace, "listTypesInNamespace");
function getTypeDetails(typeNames) {
  if (typeof typeNames !== "string" || typeNames.trim() === "") {
    throw new Error(`getTypeDetails: 'typeNames' must be a non-empty string (got ${JSON.stringify(typeNames)}). Read module.description for usage.`);
  }
  const json = CS.LLMAgent.TypeReflectionBridge.GetTypeDetails(typeNames);
  return JSON.parse(json);
}
__name(getTypeDetails, "getTypeDetails");
export {
  description,
  getTypeDetails,
  listNamespaces,
  listTypesInNamespace,
  summary
};
