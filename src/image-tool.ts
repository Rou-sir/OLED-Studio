import { packXbm } from "./bitmap";
import type { ImageOptions } from "./project";
import { parseCUnsigned } from "./c-data";

export async function readImage(bytes: Uint8Array, type: string): Promise<ImageBitmap> {
  if (bytes.length > 32 * 1024 * 1024) throw new Error("原图超过 32 MiB");
  if (!["image/png", "image/jpeg", "image/bmp", "image/x-ms-bmp"].includes(type)) throw new Error("只支持 PNG、JPEG、BMP 源图");
  imageDimensions(bytes, type);
  const image = await createImageBitmap(new Blob([bytes.slice().buffer], { type }));
  if (image.width * image.height > 16 * 1024 * 1024) { image.close(); throw new Error("原图像素总量超过 16M"); }
  return image;
}
export function imageDimensions(bytes: Uint8Array, type: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (type === "image/png") {
    if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
        view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error("PNG 文件头不完整或无效");
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (type === "image/jpeg") {
    if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) throw new Error("JPEG 文件头无效");
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error("JPEG 标记边界无效");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw new Error("JPEG 片段头截断");
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error("JPEG 片段长度无效");
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) throw new Error("JPEG 尺寸片段无效");
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (type === "image/bmp" || type === "image/x-ms-bmp") {
    if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error("BMP 文件头无效");
    const header = view.getUint32(14, true);
    if (header === 12) { width = view.getUint16(18, true); height = view.getUint16(20, true); }
    else if (header >= 40 && bytes.length >= 54) { width = view.getInt32(18, true); height = Math.abs(view.getInt32(22, true)); }
    else throw new Error("不支持的 BMP 尺寸头");
  } else throw new Error("不支持的图片类型");
  if (width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > 16 * 1024 * 1024) throw new Error("原图尺寸无效或像素总量超过 16M；未进行解码");
  return [width, height];
}
export function convertImage(image: ImageBitmap, options: ImageOptions): Uint8Array {
  const { width, height, x, y, cropWidth, cropHeight } = options;
  if (![width, height, x, y, cropWidth, cropHeight, options.threshold].every(Number.isInteger) ||
      width < 1 || height < 1 || width > 512 || height > 512 || cropWidth < 1 || cropHeight < 1 ||
      x < 0 || y < 0 || x + cropWidth > image.width || y + cropHeight > image.height ||
      options.threshold < 0 || options.threshold > 255) throw new Error("裁剪、缩放或阈值参数无效");
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建取模画布");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, x, y, cropWidth, cropHeight, 0, 0, width, height);
  return thresholdImage(width, height, ctx.getImageData(0, 0, width, height).data, options);
}
export function thresholdImage(width: number, height: number, rgba: Uint8ClampedArray, options: Pick<ImageOptions, "threshold" | "invert" | "background" | "dither">): Uint8Array {
  if (rgba.length !== width * height * 4 || !Number.isInteger(options.threshold) || options.threshold < 0 || options.threshold > 255) throw new Error("原图像素或阈值无效");
  const luminance = new Float32Array(width * height), bits = new Uint8Array(width * height);
  for (let i = 0; i < luminance.length; i++) {
    const alpha = rgba[i * 4 + 3]! / 255;
    luminance[i] = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) * alpha + options.background * 255 * (1 - alpha);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, value = luminance[i]!, on = value > 0 && value >= options.threshold;
    bits[i] = +on ^ +options.invert;
    if (options.dither) {
      const error = value - (on ? 255 : 0);
      if (x + 1 < width) luminance[i + 1]! += error * 7 / 16;
      if (y + 1 < height) {
        if (x > 0) luminance[i + width - 1]! += error * 3 / 16;
        luminance[i + width]! += error * 5 / 16;
        if (x + 1 < width) luminance[i + width + 1]! += error / 16;
      }
    }
  }
  return packXbm(width, height, bits);
}
export function importBitmap(bytes: Uint8Array, width: number, height: number, format: "lsb" | "msb" | "page", invert = false): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512) throw new Error("位图尺寸必须为 1–512 整数");
  const expected = format === "page" ? width * Math.ceil(height / 8) : Math.ceil(width / 8) * height;
  if (bytes.length !== expected) throw new Error(`取模数据长度不匹配：需要 ${expected} 字节，实际 ${bytes.length}`);
  if (format === "page" && height % 8) {
    for (let x = 0; x < width; x++) if (bytes[(Math.ceil(height / 8) - 1) * width + x]! >> (height % 8)) throw new Error("分页数据尾部未使用位不为零");
  } else if (format !== "page" && width % 8) {
    const mask = format === "lsb" ? 255 << (width % 8) : (1 << (8 - width % 8)) - 1;
    for (let y = 0; y < height; y++) if (bytes[(y + 1) * Math.ceil(width / 8) - 1]! & mask) throw new Error("逐行取模尾部未使用位不为零");
  }
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = format === "page" ? (y >> 3) * width + x : y * Math.ceil(width / 8) + (x >> 3);
    const shift = format === "page" ? y & 7 : format === "msb" ? 7 - (x & 7) : x & 7;
    bits[y * width + x] = ((bytes[offset]! >> shift) & 1) ^ +invert;
  }
  return packXbm(width, height, bits);
}
export function parseBitmapC(text: string): { bytes: Uint8Array; width?: number; height?: number } {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
  let width: number | undefined, height: number | undefined;
  const withoutDefines = clean.replace(/^\s*#define\s+\w+_(width|height)\s+(\d+)\s*$/gm, (_, key: string, value: string) => {
    if (key === "width") width = parseCUnsigned(value, 512); else height = parseCUnsigned(value, 512);
    return "";
  });
  const declaration = /^\s*(?:static\s+)?(?:const\s+)?(?:unsigned\s+char|uint8_t)\s+[A-Za-z_]\w*\s*\[(\d*)\]\s*(?:PROGMEM|U8X8_PROGMEM)?\s*=\s*\{([\s\S]*?)\}\s*;\s*$/.exec(withoutDefines);
  if (!declaration) throw new Error("只支持单个常量 uint8_t/unsigned char 字节数组；不执行 C 代码");
  const tokens = declaration[2]!.split(",").map(token => token.trim());
  if (tokens.at(-1) === "") tokens.pop();
  if (tokens.length > 32768) throw new Error("位图字节数据超过处理预算");
  const bytes = new Uint8Array(tokens.map(token => parseCUnsigned(token, 255)));
  if (declaration[1] && parseCUnsigned(declaration[1], 32768) !== bytes.length) throw new Error("C 位图声明长度不匹配");
  return { bytes, ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) };
}
