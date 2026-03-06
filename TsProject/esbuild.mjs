import { build } from 'esbuild';

// Banner code: polyfills that MUST be available before any module-level code executes.
// AI SDK uses `instanceof(URL)` in top-level schema definitions, so URL must exist globally
// before those lines run.
const bannerCode = `
// === Early Polyfills (injected by esbuild banner) ===
if (typeof globalThis.URL === 'undefined') {
    class URLPolyfill {
        constructor(input, base) {
            let url = String(input);
            if (base && !url.match(/^[a-zA-Z]+:\\/\\//)) {
                const b = String(base).replace(/\\/+$/, '');
                const path = url.startsWith('/') ? url : '/' + url;
                url = b + path;
            }
            this.href = url;
            this.protocol = ''; this.host = ''; this.hostname = '';
            this.port = ''; this.pathname = '/'; this.search = '';
            this.hash = ''; this.origin = ''; this.username = ''; this.password = '';
            const protoMatch = url.match(/^([a-zA-Z]+):\\/\\//);
            if (protoMatch) { this.protocol = protoMatch[1] + ':'; url = url.slice(protoMatch[0].length); }
            const hashIdx = url.indexOf('#');
            if (hashIdx !== -1) { this.hash = url.slice(hashIdx); url = url.slice(0, hashIdx); }
            const queryIdx = url.indexOf('?');
            if (queryIdx !== -1) { this.search = url.slice(queryIdx); url = url.slice(0, queryIdx); }
            const pathIdx = url.indexOf('/');
            if (pathIdx !== -1) { this.host = url.slice(0, pathIdx); this.pathname = url.slice(pathIdx); }
            else { this.host = url; }
            const portIdx = this.host.indexOf(':');
            if (portIdx !== -1) { this.hostname = this.host.slice(0, portIdx); this.port = this.host.slice(portIdx + 1); }
            else { this.hostname = this.host; }
            this.origin = this.protocol ? this.protocol + '//' + this.host : this.host;
        }
        toString() { return this.href; }
        toJSON() { return this.href; }
    }
    globalThis.URL = URLPolyfill;
    console.log('[Polyfill:Banner] URL installed.');
}
if (typeof globalThis.DOMException === 'undefined') {
    class DOMExceptionPolyfill extends Error {
        constructor(message, name) { super(message); this.name = name || 'Error'; this.code = 0; }
    }
    globalThis.DOMException = DOMExceptionPolyfill;
}
if (typeof globalThis.Event === 'undefined') {
    class EventPolyfill { constructor(type) { this.type = type; } }
    globalThis.Event = EventPolyfill;
}
if (typeof globalThis.structuredClone === 'undefined') {
    globalThis.structuredClone = function structuredClone(value, options) {
        if (value === undefined || value === null) return value;
        // Use JSON round-trip as a basic deep clone
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            // Fallback: return the value as-is if not serializable
            return value;
        }
    };
    console.log('[Polyfill:Banner] structuredClone installed.');
}
// === End Early Polyfills ===
`;

await build({
    entryPoints: ['src/main.mts'],
    bundle: true,
    format: 'esm',
    outfile: '../Assets/Scripts/Resources/main.mjs',
    platform: 'neutral',  // Not node, not browser - neutral for V8 embedding
    target: 'esnext',
    sourcemap: false,
    minify: false,         // Keep readable for debugging
    keepNames: true,
    banner: {
        js: bannerCode,
    },
    // Define globals that PuerTS V8 environment provides
    define: {
        'process.env.NODE_ENV': '"production"',
    },
    // Alias Node.js built-in modules to empty stubs (not available in PuerTS V8)
    alias: {
        'fs': './src/stubs/empty.mts',
        'path': './src/stubs/empty.mts',
        'os': './src/stubs/empty.mts',
        'crypto': './src/stubs/empty.mts',
        'http': './src/stubs/empty.mts',
        'https': './src/stubs/empty.mts',
        'stream': './src/stubs/empty.mts',
        'url': './src/stubs/empty.mts',
        'zlib': './src/stubs/empty.mts',
        'net': './src/stubs/empty.mts',
        'tls': './src/stubs/empty.mts',
        'events': './src/stubs/empty.mts',
        'buffer': './src/stubs/empty.mts',
        'util': './src/stubs/empty.mts',
        'child_process': './src/stubs/empty.mts',
    },
});

console.log('[esbuild] Bundle built successfully → ../Assets/Scripts/Resources/main.mjs');
