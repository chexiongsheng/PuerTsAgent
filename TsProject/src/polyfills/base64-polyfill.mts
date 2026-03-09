/**
 * Base64 Polyfill for PuerTS
 *
 * PuerTS (V8 on Unity) does not provide the browser/Node built-in
 * `atob` and `btoa` functions. The AI SDK reads them from `globalThis`
 * at module-evaluation time:
 *     var { btoa, atob: atob2 } = globalThis;
 *
 * This polyfill provides pure-JS implementations and must be installed
 * BEFORE any AI SDK code is evaluated.
 */

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Build reverse lookup table
const BASE64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < BASE64_CHARS.length; i++) {
    BASE64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i;
}

/**
 * btoa – encode a binary (latin-1) string to Base64.
 * Equivalent to the browser `btoa()`.
 */
function btoaPolyfill(binaryString: string): string {
    const len = binaryString.length;
    let result = '';
    let i = 0;

    while (i < len) {
        const a = binaryString.charCodeAt(i++) & 0xff;
        if (i >= len) {
            result += BASE64_CHARS.charAt(a >> 2);
            result += BASE64_CHARS.charAt((a & 0x3) << 4);
            result += '==';
            break;
        }
        const b = binaryString.charCodeAt(i++) & 0xff;
        if (i >= len) {
            result += BASE64_CHARS.charAt(a >> 2);
            result += BASE64_CHARS.charAt(((a & 0x3) << 4) | (b >> 4));
            result += BASE64_CHARS.charAt((b & 0xf) << 2);
            result += '=';
            break;
        }
        const c = binaryString.charCodeAt(i++) & 0xff;
        result += BASE64_CHARS.charAt(a >> 2);
        result += BASE64_CHARS.charAt(((a & 0x3) << 4) | (b >> 4));
        result += BASE64_CHARS.charAt(((b & 0xf) << 2) | (c >> 6));
        result += BASE64_CHARS.charAt(c & 0x3f);
    }

    return result;
}

/**
 * atob – decode a Base64 string to a binary (latin-1) string.
 * Equivalent to the browser `atob()`.
 */
function atobPolyfill(base64: string): string {
    // Remove any whitespace
    const cleaned = base64.replace(/[\s]/g, '');
    const len = cleaned.length;

    if (len % 4 !== 0) {
        throw new DOMException(
            "Failed to execute 'atob': The string to be decoded is not correctly encoded.",
        );
    }

    let result = '';
    let i = 0;

    while (i < len) {
        const enc1 = BASE64_LOOKUP[cleaned.charCodeAt(i++)];
        const enc2 = BASE64_LOOKUP[cleaned.charCodeAt(i++)];
        const enc3Code = cleaned.charCodeAt(i++);
        const enc4Code = cleaned.charCodeAt(i++);

        const enc3 = enc3Code === 61 /* '=' */ ? 64 : BASE64_LOOKUP[enc3Code];
        const enc4 = enc4Code === 61 /* '=' */ ? 64 : BASE64_LOOKUP[enc4Code];

        result += String.fromCharCode((enc1 << 2) | (enc2 >> 4));
        if (enc3 !== 64) {
            result += String.fromCharCode(((enc2 & 15) << 4) | (enc3 >> 2));
        }
        if (enc4 !== 64) {
            result += String.fromCharCode(((enc3 & 3) << 6) | enc4);
        }
    }

    return result;
}

/**
 * Install atob / btoa on globalThis so that the AI SDK (and any other
 * library that expects them) can find them.
 */
export function installBase64Polyfill(): void {
    const g = globalThis as any;
    if (typeof g.btoa !== 'function') {
        g.btoa = btoaPolyfill;
        console.log('[Polyfill] btoa installed (pure JS)');
    }
    if (typeof g.atob !== 'function') {
        g.atob = atobPolyfill;
        console.log('[Polyfill] atob installed (pure JS)');
    }
}
