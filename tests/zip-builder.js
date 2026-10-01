// Build a small zip archive in memory, for the tests (deflate or stored entries)

import { crc32, deflateRawSync } from 'node:zlib';

function uint16(value) {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(value);
    return bytes;
}

function uint32(value) {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value >>> 0);
    return bytes;
}

// files: { 'path/in/zip.txt': 'content' }; returns a Buffer
export function buildZip(files, { stored = false, comment = '' } = {}) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    Object.entries(files).forEach(([name, content]) => {
        const nameBytes = Buffer.from(name, 'utf8');
        const data = Buffer.from(content, 'utf8');
        const packed = stored ? data : deflateRawSync(data);
        const method = stored ? 0 : 8;
        const crc = crc32(data);

        const local = Buffer.concat([
            uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(method), uint16(0), uint16(0),
            uint32(crc), uint32(packed.length), uint32(data.length), uint16(nameBytes.length), uint16(0),
            nameBytes, packed
        ]);
        centrals.push(Buffer.concat([
            uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(method), uint16(0), uint16(0),
            uint32(crc), uint32(packed.length), uint32(data.length), uint16(nameBytes.length), uint16(0), uint16(0),
            uint16(0), uint16(0), uint32(0), uint32(offset), nameBytes
        ]));
        locals.push(local);
        offset += local.length;
    });

    const central = Buffer.concat(centrals);
    const commentBytes = Buffer.from(comment, 'utf8');
    const eocd = Buffer.concat([
        uint32(0x06054b50), uint16(0), uint16(0), uint16(centrals.length), uint16(centrals.length),
        uint32(central.length), uint32(offset), uint16(commentBytes.length), commentBytes
    ]);
    return Buffer.concat([...locals, central, eocd]);
}
