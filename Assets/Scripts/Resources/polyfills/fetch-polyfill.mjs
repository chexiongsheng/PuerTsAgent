/**
 * Fetch polyfill for PuerTS V8 environment.
 * Bridges to C# HttpBridge to perform actual HTTP requests.
 */
/**
 * Minimal Headers implementation for fetch API compatibility.
 */
class FetchHeaders {
    map = new Map();
    constructor(init) {
        if (init) {
            if (Array.isArray(init)) {
                for (const [key, value] of init) {
                    this.map.set(key.toLowerCase(), value);
                }
            }
            else {
                for (const key of Object.keys(init)) {
                    this.map.set(key.toLowerCase(), init[key]);
                }
            }
        }
    }
    get(name) {
        return this.map.get(name.toLowerCase()) ?? null;
    }
    set(name, value) {
        this.map.set(name.toLowerCase(), value);
    }
    has(name) {
        return this.map.has(name.toLowerCase());
    }
    delete(name) {
        this.map.delete(name.toLowerCase());
    }
    forEach(callback) {
        this.map.forEach((value, key) => callback(value, key));
    }
    entries() {
        return this.map.entries();
    }
    keys() {
        return this.map.keys();
    }
    values() {
        return this.map.values();
    }
    [Symbol.iterator]() {
        return this.map.entries();
    }
}
/**
 * Minimal Response implementation for fetch API compatibility.
 */
class FetchResponse {
    ok;
    status;
    statusText;
    headers;
    url;
    _bodyText;
    _bodyUsed = false;
    constructor(bodyText, status, statusText, headers, url) {
        this._bodyText = bodyText;
        this.status = status;
        this.statusText = statusText;
        this.headers = headers;
        this.url = url;
        this.ok = status >= 200 && status < 300;
    }
    get bodyUsed() {
        return this._bodyUsed;
    }
    async text() {
        this._bodyUsed = true;
        return this._bodyText;
    }
    async json() {
        this._bodyUsed = true;
        return JSON.parse(this._bodyText);
    }
    async arrayBuffer() {
        this._bodyUsed = true;
        const encoder = new TextEncoder();
        return encoder.encode(this._bodyText).buffer;
    }
    async blob() {
        // Minimal blob implementation
        const text = this._bodyText;
        return {
            text: async () => text,
            arrayBuffer: async () => {
                const encoder = new TextEncoder();
                return encoder.encode(text).buffer;
            },
            size: this._bodyText.length,
            type: this.headers.get('content-type') || '',
        };
    }
    clone() {
        return new FetchResponse(this._bodyText, this.status, this.statusText, this.headers, this.url);
    }
}
/**
 * The actual fetch implementation that calls C# HttpBridge.
 */
async function fetchImpl(input, init) {
    // Parse input
    let url;
    let method = 'GET';
    let headers = {};
    let body = null;
    if (typeof input === 'string') {
        url = input;
    }
    else if (input instanceof URL) {
        url = input.toString();
    }
    else if (input && typeof input === 'object' && 'url' in input) {
        url = input.url;
        if (input.method)
            method = input.method;
        if (input.headers) {
            if (typeof input.headers.forEach === 'function') {
                input.headers.forEach((value, key) => {
                    headers[key] = value;
                });
            }
            else {
                headers = { ...input.headers };
            }
        }
        if (input.body) {
            body = typeof input.body === 'string' ? input.body : null;
        }
    }
    else {
        url = String(input);
    }
    // Apply init overrides
    if (init) {
        if (init.method)
            method = init.method;
        if (init.headers) {
            if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers) {
                    headers[key] = value;
                }
            }
            else {
                Object.assign(headers, init.headers);
            }
        }
        if (init.body !== undefined) {
            body = init.body ? String(init.body) : null;
        }
    }
    // Check for abort signal
    if (init?.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
    }
    // Serialize headers to JSON string for C# bridge
    const headersJson = JSON.stringify(headers);
    try {
        // Call C# HttpBridge.SendRequest(url, method, headersJson, body)
        // Returns a JSON string: { "status": 200, "statusText": "OK", "headers": {...}, "body": "..." }
        const responseJson = CS.LLMAgent.Editor.HttpBridge.SendRequest(url, method, headersJson, body || '');
        const responseData = JSON.parse(responseJson);
        const responseHeaders = new FetchHeaders(responseData.headers || {});
        return new FetchResponse(responseData.body || '', responseData.status || 0, responseData.statusText || '', responseHeaders, url);
    }
    catch (error) {
        throw new TypeError(`Network request failed: ${error.message || error}`);
    }
}
/**
 * Install the fetch polyfill into globalThis.
 */
export function installFetchPolyfill() {
    if (typeof globalThis.fetch === 'undefined') {
        globalThis.fetch = fetchImpl;
        globalThis.Headers = FetchHeaders;
        globalThis.Response = FetchResponse;
        console.log('[Polyfill] fetch polyfill installed.');
    }
    else {
        console.log('[Polyfill] fetch already available, skipping polyfill.');
    }
}
