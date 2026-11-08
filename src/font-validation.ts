export interface RecordInfo { code: number; start: number; length: number; prefix: number }

export function inspectFont(bytes: Uint8Array): number[] {
  return inspectFontRecords(bytes).map(record => record.code);
}

export function inspectFontRecords(bytes: Uint8Array): RecordInfo[] {
  if (bytes.length < 25 || bytes.length > 65535) throw new Error("U8g2 字库长度须为 25–65535 字节");
  const word = (offset: number): number => {
    if (offset < 0 || offset + 2 > bytes.length) throw new Error("字库索引越界");
    return bytes[offset]! * 256 + bytes[offset + 1]!;
  };
  if (bytes[2]! < 1 || bytes[2]! > 8 || bytes[3]! < 1 || bytes[3]! > 8 ||
      bytes.slice(4, 9).some(value => value > 8) || bytes.slice(6, 9).some(value => value === 0)) throw new Error("字库位宽无效");
  const records: RecordInfo[] = [];
  const starts = new Set<number>();
  const unicode = 23 + word(21);
  let cursor = 23, last = -1;
  while (cursor + 1 < unicode) {
    const code = bytes[cursor]!, length = bytes[cursor + 1]!;
    if (!length) { cursor += 2; break; }
    if (length < 3 || cursor + length > unicode || code <= last) throw new Error("ASCII 字形记录损坏");
    starts.add(cursor); records.push({ code, start: cursor, length, prefix: 2 });
    last = code; cursor += length;
  }
  if (cursor !== unicode) throw new Error("ASCII 与 Unicode 字形边界无效");
  for (const offset of [17, 19]) {
    const target = 23 + word(offset);
    if (target !== unicode - 2 && !starts.has(target)) throw new Error("字库快速索引未指向字形");
  }
  for (const record of records) if (record.code >= 65) {
    const target = 23 + word(record.code >= 97 ? 19 : 17);
    if (target > record.start) throw new Error("ASCII 快速查找跳过了声明的字形");
  }
  if (unicode + 4 > bytes.length) {
    if (word(unicode) !== 0) throw new Error("Unicode 字库终止项损坏");
    validateRecords(bytes, records);
    return records;
  }
  const lookup: { address: number; lastCode: number }[] = [];
  let glyphStart = unicode, lookupCursor = unicode, previousCode = -1;
  while (true) {
    const jump = word(lookupCursor), lastCode = word(lookupCursor + 2);
    if (!jump || lastCode < previousCode) throw new Error("Unicode 字库查找表损坏");
    glyphStart += jump;
    if (glyphStart + 2 > bytes.length) throw new Error("Unicode 字形跳转越界");
    lookup.push({ address: glyphStart, lastCode });
    lookupCursor += 4; previousCode = lastCode;
    if (lastCode === 65535) break;
    if (lookup.length > 16384) throw new Error("字库查找表未终止");
  }
  cursor = lookup[0]!.address;
  if (cursor !== lookupCursor) throw new Error("Unicode 查找表与字形区边界无效");
  last = 255;
  const unicodeStarts = new Map<number, number>();
  while (true) {
    const code = word(cursor);
    if (!code) break;
    const length = bytes[cursor + 2]!;
    if (length < 4 || cursor + length > bytes.length || code <= last) throw new Error("Unicode 字形记录损坏");
    records.push({ code, start: cursor, length, prefix: 3 });
    unicodeStarts.set(cursor, code); last = code; cursor += length;
  }
  if (cursor + 2 < bytes.length && bytes.slice(cursor + 2).some(value => value !== 0)) throw new Error("字库尾部含未识别数据");
  for (const item of lookup) if (item.address !== cursor && !unicodeStarts.has(item.address)) throw new Error("Unicode 查找地址未指向字形");
  validateRecords(bytes, records);
  // Validate that native lookup cannot skip into unrelated glyphs or a missing terminator.
  for (const record of records.filter(record => record.code > 255)) {
    const block = lookup.find(item => item.lastCode >= record.code);
    if (!block || (unicodeStarts.get(block.address) ?? 65535) > record.code) throw new Error("Unicode 字库快速查找范围不匹配");
  }
  return records;
}

function validateRecords(bytes: Uint8Array, records: RecordInfo[]): void {
  for (const record of records) {
    let position = (record.start + record.prefix) * 8;
    const end = (record.start + record.length) * 8;
    const bits = (count: number): number => {
      if (position + count > end) throw new Error(`U+${record.code.toString(16)} 字形位流截断`);
      let value = 0;
      for (let bit = 0; bit < count; bit++, position++) value |= ((bytes[position >> 3]! >> (position & 7)) & 1) << bit;
      return value;
    };
    const width = bits(bytes[4]!), height = bits(bytes[5]!);
    bits(bytes[6]!); bits(bytes[7]!); bits(bytes[8]!);
    if (width > 127 || height > 127) throw new Error("字形尺寸超出 U8g2 解码能力");
    if (!width) continue;
    if (!height) throw new Error("非空字形高度不能为零");
    let total = 0;
    do {
      const a = bits(bytes[2]!), b = bits(bytes[3]!);
      if (a + b === 0) throw new Error("字形 RLE 包含无进展循环");
      do { total += a + b; if (total > width * height) throw new Error("字形 RLE 超出像素预算"); } while (bits(1));
    } while (total < width * height);
  }
}
