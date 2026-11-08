import * as opentype from "opentype.js";
import { parseFontC } from "./c-data";
import type { ConverterModule } from "./runtime";
import { isGlyphPixel, validateThreshold } from "./font-threshold";
import { prepareFontSource } from "./font-source";

export interface FontRequest {
  source: ArrayBuffer;
  text: string;
  size: number;
  symbol: string;
  threshold: number;
  sourceName: string;
  sourcePostscriptName: string;
}
export interface FontResult {
  type: "result";
  c: string;
  bytes: Uint8Array;
  bdf: string;
  coverage: number[];
  ascent: number;
  descent: number;
  requiresLargeFonts: boolean;
  parameters: { size: number; threshold: number; sourceName: string };
}

function drawPath(context: OffscreenCanvasRenderingContext2D, path: opentype.Path): void {
  context.beginPath();
  for (const command of path.commands) {
    switch (command.type) {
      case "M": context.moveTo(command.x, command.y); break;
      case "L": context.lineTo(command.x, command.y); break;
      case "Q": context.quadraticCurveTo(command.x1, command.y1, command.x, command.y); break;
      case "C": context.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y); break;
      case "Z": context.closePath(); break;
    }
  }
  context.fill();
}

async function convert(request: FontRequest): Promise<FontResult> {
  if (request.source.byteLength > 32 * 1024 * 1024) throw new Error("源字体超过 32 MiB 验证版限制");
  if (!Number.isInteger(request.size) || request.size < 5 || request.size > 64) throw new Error("转换像素尺寸须为 5–64");
  validateThreshold(request.threshold);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(request.symbol)) throw new Error("字体符号必须是以英文字母开头的 C 标识符");
  const font = opentype.parse(prepareFontSource(request.source, request.sourcePostscriptName));
  if (font.tables.fvar) throw new Error("第一版仅支持静态 TTF/OTF，不支持可变字体");
  const coverage = Array.from(new Set(Array.from(request.text.replace(/\r?\n/g, "")).map(char => char.codePointAt(0)!))).sort((a, b) => a - b);
  if (coverage.length < 1 || coverage.length > 2000) throw new Error("提取字符数量须为 1–2000");
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  const glyphLines: string[] = [];
  for (let index = 0; index < coverage.length; index++) {
    const code = coverage[index]!;
    const char = String.fromCodePoint(code);
    if (code < 32 || code > 0xffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw new Error(`不支持的字符：U+${code.toString(16).toUpperCase()}`);
    }
    if (font.charToGlyphIndex(char) === 0) throw new Error(`源字体缺字：${char}（U+${code.toString(16).toUpperCase()}）`);
    const glyph = font.charToGlyph(char);
    const path = glyph.getPath(0, 0, request.size);
    const box = path.getBoundingBox();
    const left = path.commands.length ? Math.floor(box.x1) : 0;
    const top = path.commands.length ? Math.floor(box.y1) : 0;
    const right = path.commands.length ? Math.ceil(box.x2) : 0;
    const bottom = path.commands.length ? Math.ceil(box.y2) : 0;
    const width = right - left, height = bottom - top;
    if (width > 127 || height > 127) throw new Error(`字形 ${char} 超出 U8g2 度量范围`);
    const advance = Math.round((glyph.advanceWidth ?? 0) * request.size / font.unitsPerEm);
    if (advance < 0 || advance > 127) throw new Error(`字形 ${char} advance 超出 U8g2 范围`);
    const bitmap: string[] = [];
    if (width && height) {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器不支持 OffscreenCanvas 2D 字形栅格化");
      context.translate(-left, -top);
      drawPath(context, path);
      const rgba = context.getImageData(0, 0, width, height).data;
      for (let y = 0; y < height; y++) {
        const row = new Uint8Array(Math.ceil(width / 8));
        for (let x = 0; x < width; x++) {
          if (isGlyphPixel(rgba[(y * width + x) * 4 + 3]!, request.threshold)) row[x >> 3]! |= 0x80 >> (x & 7);
        }
        bitmap.push(Array.from(row, byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase());
      }
    }
    minX = Math.min(minX, left); minY = Math.min(minY, -bottom);
    maxX = Math.max(maxX, right); maxY = Math.max(maxY, -top);
    glyphLines.push(`STARTCHAR uni${code.toString(16).padStart(4, "0")}\nENCODING ${code}\nSWIDTH ${Math.round(advance * 1000 / request.size)} 0\nDWIDTH ${advance} 0\nBBX ${width} ${height} ${left} ${-bottom}\nBITMAP\n${bitmap.join("\n")}\nENDCHAR`);
    self.postMessage({ type: "progress", done: index + 1, total: coverage.length });
  }
  const bdf = `STARTFONT 2.1\nCOMMENT Coverage threshold ${request.threshold}/255\nFONT -oled-custom-medium-r-normal--${request.size}-${request.size * 10}-75-75-p-0-iso10646-1\nSIZE ${request.size} 75 75\nFONTBOUNDINGBOX ${maxX - minX} ${maxY - minY} ${minX} ${minY}\nSTARTPROPERTIES 2\nFONT_ASCENT ${maxY}\nFONT_DESCENT ${-minY}\nENDPROPERTIES\nCHARS ${coverage.length}\n${glyphLines.join("\n")}\nENDFONT\n`;
  const errors: string[] = [];
  const converter: ConverterModule = await OledFontConverter({
    noInitialRun: true, noExitRuntime: true,
    print: (line: string) => errors.push(line),
    printErr: (line: string) => errors.push(line),
  });
  converter.FS.writeFile("/source.bdf", bdf);
  converter.callMain(["-f", "1", "-m", coverage.join(","), "-n", request.symbol, "-o", "/font.c", "/source.bdf"]);
  let c: string;
  try { c = converter.FS.readFile("/font.c", { encoding: "utf8" }); }
  catch (error) {
    throw new Error(`bdfconv 未生成字库：${errors.join("\n")}`, { cause: error });
  }
  const { bytes } = parseFontC(c);
  const requiresLargeFonts = bytes.length > 32760;
  if (requiresLargeFonts) {
    c = c.replace(/#endif[^\r\n]*\s*$/, '#else\n#error "Define U8G2_USE_LARGE_FONTS; use smaller font subsets on AVR."\n#endif\n');
  }
  return {
    type: "result", c: `#include "u8g2.h"\n\n/* Pixel size: ${request.size}; coverage threshold: ${request.threshold}/255. */\n` + c, bytes, bdf, coverage,
    ascent: maxY, descent: -minY, requiresLargeFonts,
    parameters: { size: request.size, threshold: request.threshold, sourceName: request.sourceName },
  };
}

self.onmessage = (event: MessageEvent<FontRequest>) => {
  convert(event.data).then(result => {
    self.postMessage(result, { transfer: [result.bytes.buffer] });
  }).catch((error: unknown) => {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
};
