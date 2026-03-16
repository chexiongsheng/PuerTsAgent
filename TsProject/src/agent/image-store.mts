/**
 * ImageStore Module
 * Stores compressed base64 image data with retrievable placeholders.
 * Also provides helpers for replacing image strings in history messages
 * and stripping old user-attached images.
 */
import { tool } from 'ai';
import { z } from 'zod';

// ============================================================
// ImageStore class
// ============================================================

/** Generate a random alphanumeric suffix of the given length. */
function randomSuffix(len: number = 5): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

/** Metadata about a stored image entry. */
interface ImageEntry {
    content: string;
    length: number;
}

export class ImageStore {
    private entries: ImageEntry[] = [];
    /** Unique prefix for image placeholders, e.g. "image_a3f9x". */
    readonly imagePrefix: string;

    constructor() {
        const suffix = randomSuffix(5);
        this.imagePrefix = `image_${suffix}`;
    }

    /** Store an image string and return its index. */
    store(content: string): number {
        const index = this.entries.length;
        this.entries.push({ content, length: content.length });
        return index;
    }

    /** Build a placeholder string for a stored entry. */
    placeholder(index: number, length: number): string {
        return `${this.imagePrefix}(${index}, ${length})`;
    }

    /** Retrieve a stored image string by index. Returns null if not found. */
    retrieve(index: number): string | null {
        if (index < 0 || index >= this.entries.length) return null;
        return this.entries[index].content;
    }

    /** Clear all stored entries and regenerate prefix. */
    clear(): void {
        this.entries = [];
        const suffix = randomSuffix(5);
        (this as any).imagePrefix = `image_${suffix}`;
    }

    get size(): number {
        return this.entries.length;
    }
}

/** Singleton ImageStore instance shared across the agent. */
export let imageStore = new ImageStore();

/**
 * Minimum string length to trigger image base64 replacement with a placeholder.
 */
export const IMAGE_COMPRESS_THRESHOLD = 500;

// ============================================================
// History compression – replace image base64 data with placeholders
// ============================================================

/** Check if a key indicates image base64 content. */
function isImageBase64Key(key: string): boolean {
    return key === 'data' || key === 'base64' || key === 'image';
}

/**
 * Recursively walk a JSON-like value and replace large base64 image strings
 * with placeholders **in-place**. Arrays and objects are mutated directly
 * so that the AI SDK's internal message references are updated, preventing
 * the same image from being stored multiple times across steps.
 * Returns true if any replacement was made.
 */
export function replaceImageStringsInPlace(obj: any, parentKey: string = ''): boolean {
    if (obj === null || obj === undefined) return false;
    // Strings cannot be mutated in-place; the caller handles replacement.
    // We only recurse into arrays and objects here.

    if (Array.isArray(obj)) {
        let changed = false;
        for (let i = 0; i < obj.length; i++) {
            const item = obj[i];
            if (typeof item === 'string') {
                if (item.length >= IMAGE_COMPRESS_THRESHOLD && isImageBase64Key(parentKey)) {
                    const idx = imageStore.store(item);
                    obj[i] = imageStore.placeholder(idx, item.length);
                    changed = true;
                }
            } else {
                if (replaceImageStringsInPlace(item, parentKey)) changed = true;
            }
        }
        return changed;
    }

    if (typeof obj === 'object') {
        // Skip AI SDK image content parts ({ type: 'image', image: <base64> }).
        // These are sent directly via the API's image_url mechanism and must
        // remain valid base64.  They will be handled separately by
        // stripOldUserImages() which removes them from older user messages.
        if (obj.type === 'image' && typeof obj.image === 'string') {
            return false;
        }

        let changed = false;
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'string') {
                if (val.length >= IMAGE_COMPRESS_THRESHOLD && isImageBase64Key(key)) {
                    const idx = imageStore.store(val);
                    obj[key] = imageStore.placeholder(idx, val.length);
                    changed = true;
                }
            } else {
                if (replaceImageStringsInPlace(val, key)) changed = true;
            }
        }
        return changed;
    }

    return false;
}

// ============================================================
// stripOldUserImages
// ============================================================

/**
 * Strip image parts from older user messages in a conversation history array.
 * The most recent user message with images is preserved (it may be
 * the current turn or a very recent reference).  Older ones have their
 * `{ type: 'image' }` content parts replaced with a text note so the
 * API doesn't receive stale (and large) base64 data.
 */
export function stripOldUserImages(conversationHistory: any[]): void {
    // Find the index of the last user message (regardless of whether it has images)
    let lastUserIdx = -1;
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if ((conversationHistory[i] as any).role === 'user') {
            lastUserIdx = i;
            break;
        }
    }

    // Find all user-message indices that contain image parts
    const indicesWithImages: number[] = [];
    for (let i = 0; i < conversationHistory.length; i++) {
        const msg = conversationHistory[i] as any;
        if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
        if (msg.content.some((p: any) => p.type === 'image')) {
            indicesWithImages.push(i);
        }
    }

    if (indicesWithImages.length === 0) return;

    // Strip images from all user messages that are NOT the last user message.
    // This ensures that when a user sends an image in turn N, but sends
    // plain text in turn N+1, the old image is cleaned up.
    const toStrip = indicesWithImages.filter(idx => idx !== lastUserIdx);
    for (const idx of toStrip) {
        const msg = conversationHistory[idx] as any;
        let strippedCount = 0;
        msg.content = msg.content.map((part: any) => {
            if (part.type === 'image' && typeof part.image === 'string') {
                strippedCount++;
                // Store the base64 data into imageStore so AI can retrieve it via retrieveImage tool
                const base64Data = part.image;
                const storeIdx = imageStore.store(base64Data);
                const placeholder = imageStore.placeholder(storeIdx, base64Data.length);
                return {
                    type: 'text' as const,
                    text: `[User-attached image was removed to save context space. Placeholder: ${placeholder} – use retrieveImage tool with index ${storeIdx} if you need to see it again.]`,
                };
            }
            return part;
        });
        if (strippedCount > 0) {
            console.log(`[Agent] Stripped ${strippedCount} image(s) from older user message at index ${idx}, stored in imageStore`);
        }
    }
}

// ============================================================
// retrieveImage tool
// ============================================================

export function createRetrieveImageTool() {
    return {
        retrieveImage: tool({
            description:
                'Retrieve the original base64 content of a compressed image placeholder. ' +
                'In conversation history, base64-encoded image data is automatically replaced with ' +
                'compact placeholders to save context space. ' +
                'Call this tool with the index from the placeholder to get the full base64 string.',
            inputSchema: z.object({
                index: z
                    .number()
                    .int()
                    .min(0)
                    .describe('The index from the placeholder, e.g. for image_xxxxx(3, 1200), index is 3.'),
            }),
            execute: async ({ index }) => {
                const content = imageStore.retrieve(index);
                if (content === null) {
                    return {
                        success: false,
                        error: `No entry found at index ${index}. Valid range: 0-${imageStore.size - 1}.`,
                    };
                }
                return {
                    success: true,
                    content,
                };
            },
        }),
    };
}
