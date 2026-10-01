// Minimal zip reader: find one entry by name and inflate it with the browser's DecompressionStream.
// Enough for a Google Takeout archive; zip64 archives (over 4 GB) are not supported

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

const utf8 = new TextDecoder();

// Entries of the central directory: [{ name, method, compressedSize, size, offset }]
export function listZipEntries(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // End of central directory record: at the end, before an optional comment
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 65535); i--) {
        if (view.getUint32(i, true) === EOCD_SIGNATURE) {
            eocd = i;
            break;
        }
    }
    if (eocd === -1) {
        throw new Error('Not a zip file');
    }

    const count = view.getUint16(eocd + 10, true);
    let position = view.getUint32(eocd + 16, true);
    if (count === 0xffff || position === 0xffffffff) {
        throw new Error('Zip64 archives are not supported');
    }

    const entries = [];
    for (let i = 0; i < count; i++) {
        if (view.getUint32(position, true) !== CENTRAL_SIGNATURE) {
            throw new Error('Corrupted zip central directory');
        }
        const nameLength = view.getUint16(position + 28, true);
        const extraLength = view.getUint16(position + 30, true);
        const commentLength = view.getUint16(position + 32, true);
        entries.push({
            name: utf8.decode(bytes.subarray(position + 46, position + 46 + nameLength)),
            method: view.getUint16(position + 10, true),
            compressedSize: view.getUint32(position + 20, true),
            size: view.getUint32(position + 24, true),
            offset: view.getUint32(position + 42, true)
        });
        position += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

// Bytes of one entry, inflated
export async function readZipEntry(buffer, entry) {
    const view = new DataView(buffer);
    if (view.getUint32(entry.offset, true) !== LOCAL_SIGNATURE) {
        throw new Error('Corrupted zip entry');
    }

    // The local header repeats the name and may carry its own extra field
    const nameLength = view.getUint16(entry.offset + 26, true);
    const extraLength = view.getUint16(entry.offset + 28, true);
    const start = entry.offset + 30 + nameLength + extraLength;
    const compressed = new Uint8Array(buffer, start, entry.compressedSize);

    if (entry.method === STORED) {
        return compressed;
    }
    if (entry.method !== DEFLATED) {
        throw new Error(`Unsupported zip compression method ${entry.method}`);
    }

    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Text of the first entry whose name matches, or null when there is none
export async function readZipText(buffer, matches) {
    const entry = listZipEntries(buffer).find(candidate => matches(candidate.name));
    return entry ? utf8.decode(await readZipEntry(buffer, entry)) : null;
}
