export function packXbm(width: number, height: number, bits: ArrayLike<number>): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 512 || height > 512 || bits.length !== width * height) {
    throw new Error("位图尺寸须为 1–512，像素数量必须匹配");
  }
  const stride = Math.ceil(width / 8);
  const result = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = bits[y * width + x];
    if (value !== 0 && value !== 1) throw new Error("单色位图像素必须为 0 或 1");
    if (value) result[y * stride + (x >> 3)]! |= 1 << (x & 7);
  }
  return result;
}

export function unpackXbm(width: number, height: number, data: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 512 || height > 512 || data.length !== Math.ceil(width / 8) * height) {
    throw new Error("XBM 尺寸或字节长度不匹配");
  }
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    bits[y * width + x] = (data[y * Math.ceil(width / 8) + (x >> 3)]! >> (x & 7)) & 1;
  }
  return bits;
}

export function bitmapBounds(width: number, height: number, bits: Uint8Array): { x: number; y: number; width: number; height: number } | undefined {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 512 || height > 512 || bits.length !== width * height) throw new Error("位图尺寸或像素数量无效");
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bit = bits[y * width + x];
    if (bit !== 0 && bit !== 1) throw new Error("单色位图像素必须为 0 或 1");
    if (bit) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  return right < 0 ? undefined : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function cropBitmap(width: number, height: number, bits: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const bounds = bitmapBounds(width, height, bits);
  if (!bounds) throw new Error("没有绘制像素，空白图片不能保存");
  const cropped = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y++)
    cropped.set(bits.subarray((bounds.y + y) * width + bounds.x, (bounds.y + y) * width + bounds.x + bounds.width), y * bounds.width);
  return { width: bounds.width, height: bounds.height, data: packXbm(bounds.width, bounds.height, cropped) };
}
