import { inflateRawSync } from 'node:zlib';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const;
/** Inspect bounded ZIP members without extracting files or executing workbook content. */
export function isXlsx(bytes: Buffer): boolean {
  try {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) return false;
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
    if (!count || count > 2000 || count !== bytes.readUInt16LE(end + 8) || offset + size !== end) return false;
    const names = new Set<string>(); let at = offset, expanded = 0; const required = new Map<string,string>();
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) return false;
      const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10), packed = bytes.readUInt32LE(at + 20), unpacked = bytes.readUInt32LE(at + 24), length = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42);
      if (flags & 1 || ![0,8].includes(method) || bytes.readUInt16LE(at + 34) || at + 46 + length + extra + comment > end) return false;
      const name = new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at + 46, at + 46 + length));
      if (!name || names.has(name) || /[\\\x00]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || /vbaProject|encryptedPackage/i.test(name)) return false;
      names.add(name); expanded += unpacked;
      if (expanded > 64_000_000 || unpacked > 16_000_000 || local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) return false;
      const nameLength = bytes.readUInt16LE(local + 26), start = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
      if (start + packed > offset || !bytes.subarray(local + 30, local + 30 + nameLength).equals(bytes.subarray(at + 46, at + 46 + length))) return false;
      const data = method === 0 ? bytes.subarray(start,start + packed) : inflateRawSync(bytes.subarray(start,start + packed),{maxOutputLength:16_000_000});
      if (data.length !== unpacked) return false;
      let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit=0;bit<8;bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
      if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32LE(at + 16)) return false;
      if (['[Content_Types].xml','xl/workbook.xml','_rels/.rels'].includes(name)) required.set(name,new TextDecoder('utf-8',{fatal:true}).decode(data));
      at += 46 + length + extra + comment;
    }
    const types = required.get('[Content_Types].xml') ?? '';
    return at === end && required.size === 3 && /spreadsheetml\.sheet\.main\+xml/.test(types) && !/macroEnabled|vbaProject/i.test(types) && /<(?:(?:\w+):)?workbook[\s>]/.test(required.get('xl/workbook.xml')!) && [...names].some(n=>/^xl\/worksheets\/[^/]+\.xml$/.test(n));
  } catch { return false; }
}
