export interface RendererModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _render_init(width: number, height: number, pageTiles: number): number;
  _render_page(tileRow: number): void;
  _render_color(color: number): void;
  _render_line(x0: number, y0: number, x1: number, y1: number): void;
  _render_pixel(x: number, y: number): void;
  _render_hvline(x: number, y: number, length: number, vertical: number): void;
  _render_ellipse(x: number, y: number, rx: number, ry: number, fill: number): void;
  _render_arc(x: number, y: number, radius: number, start: number, end: number): void;
  _render_rect(x: number, y: number, width: number, height: number, fill: number): void;
  _render_round_rect(x: number, y: number, width: number, height: number, radius: number, fill: number): void;
  _render_circle(x: number, y: number, radius: number, fill: number): void;
  _render_triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, fill: number): void;
  _render_polygon(pointer: number, count: number, fill: number): number;
  _render_bitmap(x: number, y: number, width: number, height: number, pointer: number, transparent: number): void;
  _render_font(builtin: number, pointer: number): void;
  _render_text(x: number, baseline: number, text: number, transparent: number): number;
  _render_ascent(): number;
  _render_descent(): number;
  _render_width(text: number): number;
  _render_glyph(code: number): number;
  _render_pixels(): number;
}

export interface ConverterModule {
  FS: {
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string, options: { encoding: "utf8" }): string;
  };
  callMain(args: string[]): void;
}

declare global {
  function OledRenderer(options?: Record<string, unknown>): Promise<RendererModule>;
  function OledFontConverter(options?: Record<string, unknown>): Promise<ConverterModule>;
  const OLED_WORKER_SOURCE: string;
}

export function allocate(module: RendererModule, data: Uint8Array): number {
  const pointer = module._malloc(data.byteLength);
  if (!pointer) throw new Error("U8g2 运行时内存分配失败");
  module.HEAPU8.set(data, pointer);
  return pointer;
}

export function withText<T>(module: RendererModule, text: string, action: (pointer: number) => T): T {
  const bytes = new TextEncoder().encode(text + "\0");
  const pointer = allocate(module, bytes);
  try { return action(pointer); }
  finally { module._free(pointer); }
}

export function pixels(module: RendererModule, width: number, height: number): Uint8Array {
  const pointer = module._render_pixels();
  return module.HEAPU8.slice(pointer, pointer + width * height);
}

export function assertGlyphs(module: RendererModule, text: string): void {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code > 0xffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw new Error(`U8g2 不支持字符 ${char}（U+${code.toString(16).toUpperCase()}）`);
    }
    if (char !== "\n" && !module._render_glyph(code)) {
      throw new Error(`字库缺字：${char}（U+${code.toString(16).toUpperCase().padStart(4, "0")}）`);
    }
  }
}
