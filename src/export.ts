import { zipSync, strToU8 } from "fflate";
import { builtinFonts, logicalSize, parseProject, pageCodeNames } from "./project";
import type { Component, Project } from "./project";
import type { ProjectRenderer } from "./project-renderer";
import { arcAngles, widgetOperations } from "./widget-geometry";
import { inspectFontRecords } from "./font-validation";
declare const OLED_POLYGON_SOURCE: string;
declare const OLED_U8G2_LICENSE: string;

export type ExportTarget = "arduino" | "esp-idf" | "stm32-hal";
export const exportTargets: readonly { value: ExportTarget; label: string; description: string }[] = [
  { value: "arduino", label: "Arduino", description: "仅 UI 源码/头文件：原生 C++ 方法，PROGMEM 图片 drawXBMP" },
  { value: "esp-idf", label: "ESP-IDF", description: "仅 UI 源码/头文件：U8g2 C API，常量图片 u8g2_DrawXBM" },
  { value: "stm32-hal", label: "STM32 HAL", description: "仅 UI 源码/头文件：U8g2 C API，常量图片 u8g2_DrawXBM" },
];
export function parseExportTarget(value: string): ExportTarget {
  if (value !== "arduino" && value !== "esp-idf" && value !== "stm32-hal") throw new Error("不支持的导出平台");
  return value;
}
export function symbol(id: string, prefix: string): string {
  return `${prefix}_${id.replace(/[_-]/g, char => char === "_" ? "_u" : "_h")}`;
}
export function cString(text: string): string {
  return '"' + Array.from(text, char => {
    if (char === '"') return '\\"';
    if (char === "\\") return "\\\\";
    if (char === "\n") return "\\n";
    if (char === "\r") return "\\r";
    if (char === "\t") return "\\t";
    const code = char.codePointAt(0)!;
    return code < 32 || code === 127 ? `\\${code.toString(8).padStart(3, "0")}` : char;
  }).join("").replace(/\?(?=\?)/g, "\\?") + '"';
}
function bytes(data: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < data.length; offset += 16) lines.push("  " + Array.from(data.slice(offset, offset + 16), byte => `0x${byte.toString(16).padStart(2, "0")}`).join(", ") + ",");
  return lines.join("\n");
}
function comment(text: string): string {
  return `/* ${text.replace(/\*\//g, "* /")} */\n`;
}
export function fontSymbol(name: string): string {
  return resourceSymbol(name, "font");
}
export function resourceSymbol(name: string, kind: "font" | "image"): string {
  const extension = kind === "font" ? /\.(ttf|otf|c|h|bin)$/i : /\.(png|jpe?g|bmp|xbm|c|h|bin)$/i;
  const part = Array.from(name.trim().replace(extension, ""), char =>
    /^[A-Za-z0-9_]$/.test(char) ? char : /^[\s.-]$/.test(char) ? "_" : `u${char.codePointAt(0)!.toString(16)}_`)
    .join("").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!part) throw new Error("资源名称不能为空");
  return `${kind === "font" ? "oled_font" : "oled_bitmap"}_${part}`;
}
export function fontResourceNames(resources: readonly { id: string; name: string; kind: string }[]): Map<string, string> {
  return resourceNames(resources.filter(resource => resource.kind === "font"));
}
export function resourceNames(resources: readonly { id: string; name: string; kind: string }[]): Map<string, string> {
  const used = new Set<string>(), names = new Map<string, string>();
  const named = resources.map(resource => {
    if (resource.kind !== "font" && resource.kind !== "image") throw new Error("未知资源类型");
    return { id: resource.id, base: resourceSymbol(resource.name, resource.kind) };
  });
  const reserved = new Set(named.map(resource => resource.base));
  for (const resource of named) {
    const base = resource.base;
    let name = base, suffix = 2;
    if (used.has(name)) do { name = `${base}_${suffix++}`; } while (reserved.has(name) || used.has(name));
    used.add(name); names.set(resource.id, name);
  }
  return names;
}
export function fontC(data: Uint8Array, name: string): string {
  if (!/^oled_font_[A-Za-z0-9_]+$/.test(name) || name.includes("__")) throw new Error("字库导出符号无效");
  const lines: string[] = [];
  let cursor = 0;
  for (const record of inspectFontRecords(data)) {
    if (cursor < record.start) lines.push(comment(cursor === 0 ? "U8g2 font header" : "U8g2 lookup / terminator").trimEnd(), bytes(data.slice(cursor, record.start)));
    const char = record.code >= 32 && record.code !== 127 ? JSON.stringify(String.fromCodePoint(record.code)) : "(control)";
    lines.push(comment(`U+${record.code.toString(16).toUpperCase().padStart(4, "0")} ${char}`).trimEnd(),
      bytes(data.slice(record.start, record.start + record.length)));
    cursor = record.start + record.length;
  }
  if (cursor < data.length) lines.push(comment("U8g2 lookup / terminator").trimEnd(), bytes(data.slice(cursor)));
  return `const uint8_t ${name}[${data.length}] U8G2_FONT_SECTION("${name}") = {\n${lines.join("\n")}\n};`;
}
export function generateCode(project: Project, renderer: ProjectRenderer, target: ExportTarget = "arduino"): Record<string, string> {
  parseExportTarget(target);
  parseProject(project, project.resources);
  const [width, height] = logicalSize(project);
  if (project.display.coordinateBits !== 16) throw new Error("当前正式预览运行时为 16 位坐标，尚不能保证 8 位工程像素一致，请使用 16 位 U8g2");
  for (const page of project.pages) {
    const errors = renderer.render(project, page).errors;
    if (errors.length) throw new Error("导出前请修复组件诊断：\n" + errors.join("\n"));
  }
  const referenced = new Set(project.pages.flatMap(page => page.components.filter(component => component.visible).flatMap(component =>
    component.type === "image" ? [component.resourceId] : component.type === "ascii" || component.type === "chinese" ? [component.fontId] : [])));
  const resources = project.resources.filter(resource => referenced.has(resource.id));
  const names = resourceNames(project.resources);
  const files: Record<string, string> = {};
  const arduino = target === "arduino";
  const context = arduino ? "U8G2 &display" : "u8g2_t *ctx";
  const argument = arduino ? "display" : "ctx";
  const call = (name: string, args = ""): string => arduino ?
    `display.${name[0]!.toLowerCase()}${name.slice(1)}(${args});` :
    `u8g2_${name}(ctx${args ? ", " + args : ""});`;
  const resourceDeclarations = [], resourceDefinitions = ['#include "oled_resources.h"'];
  for (const resource of resources) {
    const name = names.get(resource.id)!;
    resourceDeclarations.push(`extern const uint8_t ${name}[${resource.data.length}];`);
    const storage = resource.kind === "font" ? ` U8G2_FONT_SECTION("${name}")` : arduino ? " U8X8_PROGMEM" : "";
    const declaration = resource.kind === "font" ? fontC(resource.data, name) :
      `const uint8_t ${name}[${resource.data.length}]${storage} = {\n${bytes(resource.data)}\n};`;
    resourceDefinitions.push(comment(JSON.stringify({ id: resource.id, name: resource.name, license: resource.license })) +
      (resource.kind === "font" && resource.data.length > 32760 ?
      `#ifndef U8G2_USE_LARGE_FONTS\n#error "Enable U8G2_USE_LARGE_FONTS for ${name}"\n#endif\n${declaration}` : declaration));
  }
  files["oled_resources.h"] = `#ifndef OLED_RESOURCES_H\n#define OLED_RESOURCES_H\n#include "u8g2.h"\n#ifdef __cplusplus\nextern "C" {\n#endif\n${resourceDeclarations.join("\n")}\n#ifdef __cplusplus\n}\n#endif\n#endif\n`;
  files["oled_resources.c"] = resourceDefinitions.join("\n\n") + "\n";
  const codeNames = pageCodeNames(project.pages);
  const pageNames = codeNames.map(name => `OLED_PAGE_${name.toUpperCase()}`);
  const functions = codeNames.map(name => `oled_ui_page_${name}`);
  const cLinkStart = arduino ? "" : '#ifdef __cplusplus\nextern "C" {\n#endif\n';
  const cLinkEnd = arduino ? "" : "#ifdef __cplusplus\n}\n#endif\n";
  files["oled_ui.h"] = `#ifndef OLED_UI_H\n#define OLED_UI_H\n${arduino ? "#include <U8g2lib.h>" : '#include "u8g2.h"'}\n${cLinkStart}#ifndef U8G2_16BIT\n#error "OLED UI requires U8G2_16BIT to match the verified preview"\n#endif\ntypedef enum {\n${pageNames.map((name, index) => `  ${name} = ${index},`).join("\n")}\n} OledUiPage;\n#define OLED_UI_DEFAULT_PAGE ${pageNames[project.pages.findIndex(page => page.id === project.defaultPageId)]}\n#define OLED_UI_WIDTH ${width}\n#define OLED_UI_HEIGHT ${height}\n/* Return 1 when drawn, 0 for an invalid context/page. Caller owns initialization and flushing. */\nint oled_ui_draw(${context}, OledUiPage page);\n${functions.map(name => `int ${name}(${context});`).join("\n")}\n${cLinkEnd}#endif\n`;
  const drawComponent = (component: Component, index: number): string[] => {
    const lines = [call("SetDrawColor", String(component.bit))];
    switch (component.type) {
      case "point": lines.push(call("DrawPixel", `${component.x}, ${component.y}`)); break;
      case "hline": case "vline": lines.push(call(component.type === "hline" ? "DrawHLine" : "DrawVLine", `${component.x}, ${component.y}, ${component.length}`)); break;
      case "ellipse": lines.push(call(component.fill ? "DrawFilledEllipse" : "DrawEllipse", `${component.x}, ${component.y}, ${component.rx}, ${component.ry}, U8G2_DRAW_ALL`)); break;
      case "arc": lines.push(call("DrawArc", `${component.x}, ${component.y}, ${component.radius}, ${arcAngles(component.startAngle, component.sweepAngle).join(", ")}`)); break;
      case "progress": case "battery": case "sector":
        for (const op of widgetOperations(component)) {
          switch (op.type) {
            case "color": lines.push(call("SetDrawColor", String(op.bit))); break;
            case "box": case "frame": lines.push(call(op.type === "box" ? "DrawBox" : "DrawFrame", `${op.x}, ${op.y}, ${op.width}, ${op.height}`)); break;
            case "line": lines.push(call("DrawLine", `${op.x}, ${op.y}, ${op.x1}, ${op.y1}`)); break;
            case "triangle": lines.push(call("DrawTriangle", op.points.join(", "))); break;
            case "disc": lines.push(call("DrawDisc", `${op.x}, ${op.y}, ${op.radius}, U8G2_DRAW_ALL`)); break;
          }
        }
        break;
      case "line": lines.push(call("DrawLine", component.points.flat().join(", "))); break;
      case "rect": lines.push(call(`Draw${component.radius ? component.fill ? "RBox" : "RFrame" : component.fill ? "Box" : "Frame"}`, `${component.x}, ${component.y}, ${component.width}, ${component.height}${component.radius ? ", " + component.radius : ""}`)); break;
      case "circle": lines.push(call(`Draw${component.fill ? "Disc" : "Circle"}`, `${component.x}, ${component.y}, ${component.radius}, U8G2_DRAW_ALL`)); break;
      case "triangle":
        if (component.fill) lines.push(call("DrawTriangle", component.points.flat().join(", ")));
        else for (let i = 0; i < 3; i++) lines.push(call("DrawLine", [...component.points[i]!, ...component.points[(i + 1) % 3]!].join(", ")));
        break;
      case "polygon":
        lines.push(`{ const int16_t vertices_${index}[] = { ${component.points.flat().join(", ")} };`,
          `  (void)oled_polygon(${arduino ? "&display" : "ctx"}, vertices_${index}, ${component.points.length}, ${+component.fill}); }`);
        break;
      case "image": {
        const resource = project.resources.find(resource => resource.id === component.resourceId)!;
        if (resource.kind !== "image") throw new Error("图片引用无效");
        lines.push(call("SetBitmapMode", String(+component.transparent)),
          call(arduino ? "DrawXBMP" : "DrawXBM", `${component.x}, ${component.y}, ${resource.width}, ${resource.height}, ${names.get(resource.id)}`));
        break;
      }
      case "ascii": case "chinese":
        lines.push(call("SetFont", builtinFonts.find(font => font.id === component.fontId)?.symbol ?? names.get(component.fontId)!),
          call("SetFontRefHeightAll"), call("SetFontPosBaseline"), call("SetFontMode", String(+component.transparent)));
        for (const line of renderer.textLines(project, component)) lines.push(call("DrawUTF8", `${line.x}, ${line.baseline}, ${cString(line.text)}`));
        break;
    }
    return lines;
  };
  files[arduino ? "oled_ui.cpp" : "oled_ui.c"] = `#include "oled_ui.h"\n#include "oled_resources.h"\n${arduino ? "#define OLED_POLYGON_CPP\n" : ""}#include "oled_polygon.h"\n\n` +
    project.pages.map((page, index) => `int ${functions[index]}(${context})\n{\n${arduino ? "" : "  if (!ctx) return 0;\n"}  ${call("SetFontDirection", "0")}\n` +
      `  ${call("SetDrawColor", String(page.background))}\n  ${call("DrawBox", `0, 0, ${width}, ${height}`)}\n` +
      page.components.filter(component => component.visible).flatMap(drawComponent).map(line => "  " + line + "\n").join("") +
      "  return 1;\n}\n\n").join("") +
    `int oled_ui_draw(${context}, OledUiPage page)\n{\n  switch (page) {\n` +
    project.pages.map((_, index) => `    case ${pageNames[index]}: return ${functions[index]}(${argument});\n`).join("") +
    "    default: return 0;\n  }\n}\n";
  files["oled_polygon.h"] = comment(OLED_U8G2_LICENSE) + OLED_POLYGON_SOURCE;
  if (arduino) files["oled_ui_arduino.hpp"] = '#ifndef OLED_UI_ARDUINO_HPP\n#define OLED_UI_ARDUINO_HPP\n#include "oled_ui.h"\n#endif\n';
  files["oled_ui.h"] = comment(JSON.stringify({ project: project.name,
    pages: project.pages.map((page, index) => ({ id: page.id, name: page.name, symbol: pageNames[index] })) })) +
    files["oled_ui.h"].replace("#define OLED_UI_H\n", `#define OLED_UI_H\n#define OLED_UI_ROTATION ${project.display.rotation}\n#define OLED_UI_FULL_BUFFER ${+(project.display.bufferMode === "full")}\n#define OLED_UI_PAGE_COUNT ${project.pages.length}\n`);
  return files;
}
export function exportProject(project: Project, renderer: ProjectRenderer, target: ExportTarget = "arduino"): Uint8Array {
  const files = generateCode(project, renderer, target);
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])), { level: 1 });
}
