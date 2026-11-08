interface FontTable { tag: number; offset: number; length: number }
const NAME = 0x6e616d65;
const HEAD = 0x68656164;
const DSIG = 0x44534947;

function checkRange(offset: number, length: number, total: number): void {
  if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset + length > total) {
    throw new Error("电脑字体集合的数据范围损坏");
  }
}

function tablesAt(view: DataView, offset: number): FontTable[] {
  checkRange(offset, 12, view.byteLength);
  const signature = view.getUint32(offset);
  if (signature !== 0x00010000 && signature !== 0x4f54544f) throw new Error("集合成员不是支持的静态 TTF/OTF");
  const count = view.getUint16(offset + 4);
  if (count < 1 || count > 256) throw new Error("字体集合成员的表数量无效");
  checkRange(offset + 12, count * 16, view.byteLength);
  const tables: FontTable[] = [];
  const tags = new Set<number>();
  for (let index = 0; index < count; index++) {
    const record = offset + 12 + index * 16;
    const tag = view.getUint32(record), start = view.getUint32(record + 8), length = view.getUint32(record + 12);
    if (tags.has(tag)) throw new Error("字体集合成员包含重复数据表");
    checkRange(start, length, view.byteLength);
    tags.add(tag); tables.push({ tag, offset: start, length });
  }
  return tables;
}

function hasPostscriptName(view: DataView, table: FontTable, name: string): boolean {
  if (table.length < 6) throw new Error("电脑字体名称表不完整");
  const count = view.getUint16(table.offset + 2), strings = view.getUint16(table.offset + 4);
  if (6 + count * 12 > table.length || strings < 6 + count * 12 || strings > table.length) {
    throw new Error("电脑字体名称索引损坏");
  }
  for (let index = 0; index < count; index++) {
    const record = table.offset + 6 + index * 12;
    if (view.getUint16(record + 6) !== 6) continue;
    const platform = view.getUint16(record), length = view.getUint16(record + 8), relative = view.getUint16(record + 10);
    if (strings + relative + length > table.length) throw new Error("电脑字体名称字符串越界");
    const start = table.offset + strings + relative;
    let decoded = "";
    if (platform === 0 || platform === 3) {
      if (length % 2) throw new Error("电脑字体 Unicode 名称长度无效");
      for (let i = 0; i < length; i += 2) decoded += String.fromCharCode(view.getUint16(start + i));
    } else if (platform === 1) {
      for (let i = 0; i < length; i++) decoded += String.fromCharCode(view.getUint8(start + i));
    }
    if (decoded === name) return true;
  }
  return false;
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const word = ((data[offset] ?? 0) * 0x1000000 + (data[offset + 1] ?? 0) * 0x10000 +
      (data[offset + 2] ?? 0) * 0x100 + (data[offset + 3] ?? 0));
    sum = (sum + word) >>> 0;
  }
  return sum;
}

export function prepareFontSource(source: ArrayBuffer, postscriptName: string): ArrayBuffer {
  if (source.byteLength < 12) throw new Error("字体文件不完整");
  const view = new DataView(source);
  if (view.getUint32(0) !== 0x74746366) return source;
  if (!postscriptName) throw new Error("自定义导入暂不支持 TTC 集合，请改用电脑字体列表选择具体字体，或导入独立 TTF/OTF。");
  const version = view.getUint32(4);
  if (version !== 0x00010000 && version !== 0x00020000) throw new Error("不支持的 TTC 集合版本");
  const count = view.getUint32(8);
  if (count < 1 || count > 64) throw new Error("TTC 集合成员数量须为 1–64");
  checkRange(12, count * 4, source.byteLength);
  let chosen: { offset: number; tables: FontTable[] } | undefined;
  for (let index = 0; index < count; index++) {
    const offset = view.getUint32(12 + index * 4);
    const tables = tablesAt(view, offset), nameTable = tables.find(table => table.tag === NAME);
    if (nameTable && hasPostscriptName(view, nameTable, postscriptName)) {
      if (chosen) throw new Error("TTC 集合中字体名称不唯一，无法确定所选样式");
      chosen = { offset, tables };
    }
  }
  if (!chosen) throw new Error("TTC 集合中未找到所选字体样式，不会用其他成员替代");
  const tables = chosen.tables.filter(table => table.tag !== DSIG).sort((a, b) => a.tag - b.tag);
  const size = 12 + tables.length * 16 + tables.reduce((sum, table) => sum + Math.ceil(table.length / 4) * 4, 0);
  if (size > 32 * 1024 * 1024) throw new Error("提取后的电脑字体超过 32 MiB 验证版限制");
  const output = new Uint8Array(size), result = new DataView(output.buffer);
  result.setUint32(0, view.getUint32(chosen.offset));
  result.setUint16(4, tables.length);
  const selector = Math.floor(Math.log2(tables.length)), searchRange = 16 * 2 ** selector;
  result.setUint16(6, searchRange); result.setUint16(8, selector);
  result.setUint16(10, tables.length * 16 - searchRange);
  let dataOffset = 12 + tables.length * 16, headOffset: number | undefined;
  tables.forEach((table, index) => {
    output.set(new Uint8Array(source, table.offset, table.length), dataOffset);
    if (table.tag === HEAD) {
      if (table.length < 12) throw new Error("电脑字体 head 表不完整");
      headOffset = dataOffset; result.setUint32(dataOffset + 8, 0);
    }
    const record = 12 + index * 16;
    result.setUint32(record, table.tag);
    result.setUint32(record + 4, checksum(output.subarray(dataOffset, dataOffset + table.length)));
    result.setUint32(record + 8, dataOffset); result.setUint32(record + 12, table.length);
    dataOffset += Math.ceil(table.length / 4) * 4;
  });
  if (headOffset === undefined) throw new Error("电脑字体缺少 head 表");
  result.setUint32(headOffset + 8, (0xb1b0afba - checksum(output)) >>> 0);
  return output.buffer;
}
