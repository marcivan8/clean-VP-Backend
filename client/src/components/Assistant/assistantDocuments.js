const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ASSISTANT_DOCUMENTS = 4;
export const MAX_DOCUMENT_CHARS = 16_000;

const SUPPORTED_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'docx']);
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

const extensionOf = (name = '') => name.split('.').pop()?.toLowerCase() || '';

const decodeXmlText = (xml) => xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .trim();

async function readDocx(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let endOffset = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { endOffset = i; break; }
    }
    if (endOffset < 0) fail('documentInvalid');

    const entryCount = view.getUint16(endOffset + 10, true);
    let cursor = view.getUint32(endOffset + 16, true);
    const decoder = new TextDecoder();
    for (let i = 0; i < entryCount; i++) {
        if (view.getUint32(cursor, true) !== 0x02014b50) break;
        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        if (path === 'word/document.xml') {
            if (uncompressedSize > 8 * 1024 * 1024) fail('documentTooLarge');
            const localNameLength = view.getUint16(localOffset + 26, true);
            const localExtraLength = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + localNameLength + localExtraLength;
            const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
            let xmlBytes = compressed;
            if (method === 8) {
                if (typeof DecompressionStream === 'undefined') fail('documentBrowserUnsupported');
                const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
            } else if (method !== 0) {
                fail('documentCompressionUnsupported');
            }
            return decodeXmlText(decoder.decode(xmlBytes));
        }
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    fail('documentNoText');
}

export async function readAssistantDocument(file) {
    const extension = extensionOf(file?.name);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        fail('documentUnsupported');
    }
    if (!file || file.size > MAX_FILE_BYTES) fail('documentTooLarge');

    const rawText = extension === 'docx' ? await readDocx(file) : await file.text();
    const text = rawText.split(String.fromCharCode(0)).join('').trim();
    if (!text) fail('documentNoText');
    return {
        id: `${file.name}-${file.lastModified || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        text: text.length > MAX_DOCUMENT_CHARS ? `${text.slice(0, MAX_DOCUMENT_CHARS)}\n[Document text truncated]` : text,
        truncated: text.length > MAX_DOCUMENT_CHARS,
    };
}

export function withAssistantDocuments(prompt, documents, defaultPrompt = 'Use the attached document(s) as the editing brief for this project.') {
    if (!documents?.length) return prompt;
    const request = prompt?.trim() || defaultPrompt;
    const references = documents.map(({ name, text }) => `--- ${name} ---\n${text}`).join('\n\n');
    return `${request}\n\nReference documents supplied by the user (use these to guide the edit):\n${references}`;
}

export function withAssistantMedia(prompt, media, defaultPrompt = 'Use the attached media for this edit.') {
    if (!media?.length) return prompt;
    const request = String(prompt || '').trim() || defaultPrompt;
    const list = media.map(({ id, name, type }) => `- ${name || 'Untitled media'} (${type || 'visual'}, reference asset id: ${id})`).join('\n');
    return `${request}\n\nReference media supplied by the user for guidance only (not source footage):\n${list}\nUse these references to guide the edit of the user's source video. Do not place reference media on the timeline.`;
}
