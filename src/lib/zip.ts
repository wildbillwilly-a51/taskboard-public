type ZipFileEntry = {
  name: string;
  data: Buffer | string;
  lastModified?: Date;
};

type NormalizedZipFileEntry = {
  name: string;
  data: Buffer;
  crc32: number;
  lastModified: Date;
};

const crcTable = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  crcTable[index] = value >>> 0;
}

function computeCrc32(buffer: Buffer) {
  let crc = 0xffffffff;

  for (const value of buffer) {
    crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(input: Date) {
  const year = Math.max(input.getFullYear(), 1980);
  const month = input.getMonth() + 1;
  const day = input.getDate();
  const hours = input.getHours();
  const minutes = input.getMinutes();
  const seconds = Math.floor(input.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;

  return { dosDate, dosTime };
}

function normalizeZipEntry(entry: ZipFileEntry): NormalizedZipFileEntry {
  const buffer =
    typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data);

  return {
    name: entry.name.replace(/\\/g, "/"),
    data: buffer,
    crc32: computeCrc32(buffer),
    lastModified: entry.lastModified ?? new Date(),
  };
}

export function createZipArchive(entries: ZipFileEntry[]) {
  const normalizedEntries = entries.map(normalizeZipEntry);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of normalizedEntries) {
    const fileNameBuffer = Buffer.from(entry.name, "utf8");
    const { dosDate, dosTime } = toDosDateTime(entry.lastModified);

    const localHeader = Buffer.alloc(30 + fileNameBuffer.length);
    let cursor = 0;
    localHeader.writeUInt32LE(0x04034b50, cursor);
    cursor += 4;
    localHeader.writeUInt16LE(20, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(dosTime, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(dosDate, cursor);
    cursor += 2;
    localHeader.writeUInt32LE(entry.crc32, cursor);
    cursor += 4;
    localHeader.writeUInt32LE(entry.data.length, cursor);
    cursor += 4;
    localHeader.writeUInt32LE(entry.data.length, cursor);
    cursor += 4;
    localHeader.writeUInt16LE(fileNameBuffer.length, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    fileNameBuffer.copy(localHeader, cursor);

    localParts.push(localHeader, entry.data);

    const centralHeader = Buffer.alloc(46 + fileNameBuffer.length);
    cursor = 0;
    centralHeader.writeUInt32LE(0x02014b50, cursor);
    cursor += 4;
    centralHeader.writeUInt16LE(20, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(20, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(dosTime, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(dosDate, cursor);
    cursor += 2;
    centralHeader.writeUInt32LE(entry.crc32, cursor);
    cursor += 4;
    centralHeader.writeUInt32LE(entry.data.length, cursor);
    cursor += 4;
    centralHeader.writeUInt32LE(entry.data.length, cursor);
    cursor += 4;
    centralHeader.writeUInt16LE(fileNameBuffer.length, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt16LE(0, cursor);
    cursor += 2;
    centralHeader.writeUInt32LE(0, cursor);
    cursor += 4;
    centralHeader.writeUInt32LE(offset, cursor);
    cursor += 4;
    fileNameBuffer.copy(centralHeader, cursor);

    centralParts.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const endRecord = Buffer.alloc(22);
  let cursor = 0;

  endRecord.writeUInt32LE(0x06054b50, cursor);
  cursor += 4;
  endRecord.writeUInt16LE(0, cursor);
  cursor += 2;
  endRecord.writeUInt16LE(0, cursor);
  cursor += 2;
  endRecord.writeUInt16LE(normalizedEntries.length, cursor);
  cursor += 2;
  endRecord.writeUInt16LE(normalizedEntries.length, cursor);
  cursor += 2;
  endRecord.writeUInt32LE(centralDirectory.length, cursor);
  cursor += 4;
  endRecord.writeUInt32LE(localDirectory.length, cursor);
  cursor += 4;
  endRecord.writeUInt16LE(0, cursor);

  return Buffer.concat([localDirectory, centralDirectory, endRecord]);
}
