/**
 * Type Reflection Tools for AI Agent
 *
 * Progressive disclosure of C# type information:
 *   Tool 1: listNamespaces     – all namespaces in the runtime
 *   Tool 2: listTypesInNamespace – types (name + kind) under given namespaces
 *   Tool 3: getTypeDetails     – full signatures (properties, methods, fields) for given types
 *
 * Backed by C# TypeReflectionBridge which uses System.Reflection with caching.
 */
import { tool } from 'ai';
import { z } from 'zod';

/**
 * Create the three progressive-disclosure type reflection tools.
 */
export function createTypeReflectionTools() {
    return {
        /**
         * Tool 1: List all C# namespaces available in the runtime.
         */
        listNamespaces: tool({
            description:
                'List all C# namespaces found across all loaded assemblies in the Unity runtime. ' +
                'Use this as the first step when exploring available C# APIs. ' +
                'The result is cached after the first call, so subsequent calls are fast. ' +
                'Returns a JSON object with a "namespaces" array of namespace name strings.',
            inputSchema: z.object({}),
            execute: async () => {
                try {
                    const json = CS.LLMAgent.TypeReflectionBridge.GetAllNamespaces();
                    return JSON.parse(json);
                } catch (error: any) {
                    return {
                        success: false,
                        error: `Failed to list namespaces: ${error.message || error}`,
                    };
                }
            },
        }),

        /**
         * Tool 2: List types in one or more namespaces (no member details).
         */
        listTypesInNamespace: tool({
            description:
                'List all public types (classes, structs, enums, interfaces, delegates) under ' +
                'one or more C# namespaces. Returns type name, full name, and kind for each type. ' +
                'Does NOT return property/method details – use getTypeDetails for that. ' +
                'Pass one or more namespace names separated by commas.',
            inputSchema: z.object({
                namespaces: z
                    .string()
                    .describe(
                        'Comma-separated namespace names to query, ' +
                        'e.g. "UnityEngine,UnityEngine.UI". Must match exactly.'
                    ),
            }),
            execute: async ({ namespaces }) => {
                try {
                    const json = CS.LLMAgent.TypeReflectionBridge.GetTypesInNamespaces(namespaces);
                    return JSON.parse(json);
                } catch (error: any) {
                    return {
                        success: false,
                        error: `Failed to list types: ${error.message || error}`,
                    };
                }
            },
        }),

        /**
         * Tool 3: Get detailed signatures for one or more types.
         */
        getTypeDetails: tool({
            description:
                'Get detailed information about one or more C# types, including all public ' +
                'properties (with get/set), methods (with full parameter signatures), fields, ' +
                'implemented interfaces, base type, and enum values (for enums). ' +
                'Pass fully-qualified type names separated by commas, ' +
                'e.g. "UnityEngine.Transform,UnityEngine.GameObject".',
            inputSchema: z.object({
                typeNames: z
                    .string()
                    .describe(
                        'Comma-separated fully-qualified type names, ' +
                        'e.g. "UnityEngine.Transform,UnityEngine.GameObject".'
                    ),
            }),
            execute: async ({ typeNames }) => {
                try {
                    const json = CS.LLMAgent.TypeReflectionBridge.GetTypeDetails(typeNames);
                    return JSON.parse(json);
                } catch (error: any) {
                    return {
                        success: false,
                        error: `Failed to get type details: ${error.message || error}`,
                    };
                }
            },
        }),
    };
}
