import { validatePolygon } from "./geometry";
import type { Point } from "./geometry";
import { inspectFont } from "./font-validation";

export type Bit = 0 | 1;
interface Common { id: string; name: string; visible: boolean; locked: boolean; bit: Bit }
export type Component =
  | (Common & { type: "point"; x: number; y: number })
  | (Common & { type: "hline"; x: number; y: number; length: number })
  | (Common & { type: "vline"; x: number; y: number; length: number })
  | (Common & { type: "ellipse"; x: number; y: number; rx: number; ry: number; fill: boolean })
  | (Common & { type: "arc"; x: number; y: number; radius: number; startAngle: number; sweepAngle: number })
  | (Common & { type: "sector"; x: number; y: number; radius: number; startAngle: number; sweepAngle: number })
  | (Common & { type: "progress"; x: number; y: number; width: number; height: number; min: number; max: number; value: number; vertical: boolean; border: boolean })
  | (Common & { type: "battery"; x: number; y: number; width: number; height: number; value: number; charging: boolean })
  | (Common & { type: "line"; points: [Point, Point] })
  | (Common & { type: "triangle"; points: [Point, Point, Point]; fill: boolean })
  | (Common & { type: "polygon"; points: Point[]; fill: boolean })
  | (Common & { type: "rect"; x: number; y: number; width: number; height: number; radius: number; fill: boolean })
  | (Common & { type: "circle"; x: number; y: number; radius: number; fill: boolean })
  | (Common & { type: "ascii" | "chinese"; x: number; y: number; text: string; fontId: string; align: "left" | "center" | "right"; lineGap: number; transparent: boolean })
  | (Common & { type: "image"; x: number; y: number; resourceId: string; transparent: boolean });
export interface ImageOptions {
  x: number; y: number; cropWidth: number; cropHeight: number;
  width: number; height: number; threshold: number; invert: boolean; background: Bit; dither: boolean;
}
interface ResourceCommon { id: string; name: string; license: string; data: Uint8Array; sourceName?: string }
export type Resource =
  | (ResourceCommon & { kind: "image"; width: number; height: number; source?: Uint8Array; sourceType?: string; options?: ImageOptions })
  | (ResourceCommon & { kind: "font"; coverage: number[]; source?: Uint8Array; postscriptName?: string; size?: number; threshold?: number });
export interface Page { id: string; name: string; codeName?: string; background: Bit; components: Component[] }
function parsePageCodeName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) || value.includes("__"))
    throw new Error("页面代码名称须为字母开头的 1–64 位英文、数字或下划线，不能含连续下划线");
  return value;
}
export function pageCodeNames(pages: readonly Page[]): string[] {
  const used = new Set<string>();
  for (const page of pages) if (page.codeName !== undefined) {
    parsePageCodeName(page.codeName);
    const key = page.codeName.toLowerCase();
    if (used.has(key)) throw new Error("页面代码名称重复（不区分大小写）");
    used.add(key);
  }
  return pages.map(page => {
    if (page.codeName !== undefined) return page.codeName;
    let index = 1;
    while (used.has(`page${index}`)) index++;
    const name = `page${index}`; used.add(name); return name;
  });
}
export function nextPageCodeName(pages: readonly Page[]): string {
  const used = new Set(pageCodeNames(pages).map(name => name.toLowerCase()));
  let index = 1; while (used.has(`page${index}`)) index++;
  return `page${index}`;
}
export function nextComponentName(components: readonly Component[], type: Component["type"]): string {
  let index = 1;
  while (components.some(component => component.name === `${type}${index}`)) index++;
  return `${type}${index}`;
}
export interface Project {
  schemaVersion: 1; id: string; name: string; description: string; createdAt: string; modifiedAt: string;
  display: { width: number; height: number; rotation: 0 | 90 | 180 | 270; coordinateBits: 8 | 16; bufferMode: "full" | "page"; controller: string };
  pages: Page[]; defaultPageId: string; resources: Resource[];
}
export const builtinFonts = [
  { id: "builtin-5x7", symbol: "u8g2_font_5x7_tr", name: "5 × 7", height: 7 },
  { id: "builtin-6x10", symbol: "u8g2_font_6x10_tr", name: "6 × 10", height: 10 },
  { id: "builtin-9x15", symbol: "u8g2_font_9x15_tr", name: "9 × 15", height: 15 },
] as const;
export function id(): string { return crypto.randomUUID(); }
export function logicalSize(project: Project): [number, number] {
  const { width, height, rotation } = project.display;
  return rotation === 90 || rotation === 270 ? [height, width] : [width, height];
}
export function createProject(name = "新项目"): Project {
  const page: Page = { id: id(), name: "首页", codeName: "page1", background: 0, components: [] };
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: id(), name, description: "", createdAt: now, modifiedAt: now,
    display: { width: 128, height: 64, rotation: 0, coordinateBits: 16, bufferMode: "full", controller: "" },
    pages: [page], defaultPageId: page.id, resources: [] };
}
export function createComponent(type: Component["type"]): Component {
  const common = { id: id(), name: `${type}1`, visible: true, locked: false, bit: 1 as const };
  switch (type) {
    case "point": return { ...common, type, x: 10, y: 10 };
    case "hline": case "vline": return { ...common, type, x: 10, y: 10, length: 35 };
    case "ellipse": return { ...common, type, x: 35, y: 25, rx: 20, ry: 10, fill: false };
    case "arc": case "sector": return { ...common, type, x: 35, y: 30, radius: 20, startAngle: 0, sweepAngle: 180 };
    case "progress": return { ...common, type, x: 10, y: 10, width: 70, height: 12, min: 0, max: 100, value: 50, vertical: false, border: true };
    case "battery": return { ...common, type, x: 10, y: 10, width: 28, height: 14, value: 75, charging: false };
    case "line": return { ...common, type, points: [[10, 10], [45, 25]] };
    case "triangle": return { ...common, type, points: [[10, 35], [25, 10], [40, 35]], fill: false };
    case "polygon": return { ...common, type, points: [[10, 10], [40, 10], [40, 35], [25, 25], [10, 35]], fill: false };
    case "rect": return { ...common, type, x: 10, y: 10, width: 35, height: 20, radius: 0, fill: false };
    case "circle": return { ...common, type, x: 25, y: 25, radius: 12, fill: false };
    case "ascii": case "chinese": return { ...common, type, x: 5, y: 5, text: type === "ascii" ? "Hello OLED" : "中文",
      fontId: type === "ascii" ? builtinFonts[0].id : "", align: "left", lineGap: 2, transparent: true };
    case "image": return { ...common, type, x: 10, y: 10, resourceId: "", transparent: true };
  }
}
export function snapshot(project: Project): Project {
  return { ...project, display: { ...project.display }, pages: project.pages.map(page => ({ ...page,
    components: structuredClone(page.components) })), resources: project.resources.map(resource => ({ ...resource })) };
}
export function resourceReferences(project: Project, resourceId: string): { page: Page; component: Component }[] {
  return project.pages.flatMap(page => page.components.filter(component =>
    component.type === "image" ? component.resourceId === resourceId :
      (component.type === "ascii" || component.type === "chinese") && component.fontId === resourceId)
    .map(component => ({ page, component })));
}
export function moveComponent(component: Component, dx: number, dy: number): void {
  if ("points" in component) component.points = component.points.map(([x, y]) => [x + dx, y + dy]) as typeof component.points;
  else { component.x += dx; component.y += dy; }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("项目对象格式错误");
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error("项目字符串无效或过长");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`整数参数须为 ${min}–${max}`);
  return value;
}
function bool(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("布尔参数格式错误"); return value; }
function bit(value: unknown): Bit { if (value !== 0 && value !== 1) throw new Error("像素值必须为 0/1"); return value; }
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("项目列表无效或超过处理预算");
  return value;
}
function identifier(value: unknown): string {
  const result = string(value, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result)) throw new Error("项目标识符无效");
  return result;
}
function points(value: unknown): Point[] {
  return list(value, 256).map(point => {
    const pair = list(point, 2);
    if (pair.length !== 2) throw new Error("顶点必须有两个坐标");
    return [integer(pair[0], -2048, 2048), integer(pair[1], -2048, 2048)];
  });
}
export function parseComponent(input: unknown): Component {
  const value = object(input), type = string(value["type"]);
  const common = { id: identifier(value["id"]), name: string(value["name"]), visible: bool(value["visible"]),
    locked: bool(value["locked"]), bit: bit(value["bit"]) };
  if (type === "line" || type === "triangle" || type === "polygon") {
    const p = points(value["points"]);
    if (type === "line") {
      if (p.length !== 2) throw new Error("线段需要两点");
      return { ...common, type, points: [p[0]!, p[1]!] };
    }
    const fill = bool(value["fill"]);
    validatePolygon(p, fill);
    if (type === "triangle") {
      if (p.length !== 3) throw new Error("三角形需要三点");
      return { ...common, type, points: [p[0]!, p[1]!, p[2]!] , fill };
    }
    return { ...common, type, points: p, fill };
  }
  const xy = { x: integer(value["x"], -2048, 2048), y: integer(value["y"], -2048, 2048) };
  if (type === "point") return { ...common, type, ...xy };
  if (type === "hline" || type === "vline") return { ...common, type, ...xy, length: integer(value["length"], 1, 512) };
  if (type === "ellipse") return { ...common, type, ...xy, rx: integer(value["rx"], 1, 512), ry: integer(value["ry"], 1, 512), fill: bool(value["fill"]) };
  if (type === "arc" || type === "sector") return { ...common, type, ...xy, radius: integer(value["radius"], 1, 512),
    startAngle: integer(value["startAngle"], 0, 359), sweepAngle: integer(value["sweepAngle"], 1, 360) };
  if (type === "progress") {
    const min = integer(value["min"], -1000000, 1000000), max = integer(value["max"], -1000000, 1000000);
    if (min >= max) throw new Error("进度条最大值必须大于最小值");
    return { ...common, type, ...xy, min, max, value: integer(value["value"], min, max),
      width: integer(value["width"], 3, 512), height: integer(value["height"], 3, 512),
      vertical: bool(value["vertical"]), border: bool(value["border"]) };
  }
  if (type === "battery") return { ...common, type, ...xy, width: integer(value["width"], 8, 512), height: integer(value["height"], 7, 512),
    value: integer(value["value"], 0, 100), charging: bool(value["charging"]) };
  if (type === "rect") {
    const width = integer(value["width"], 1, 512), height = integer(value["height"], 1, 512);
    return { ...common, type, ...xy, width, height, radius: integer(value["radius"], 0, Math.floor(Math.min(width, height) / 2)), fill: bool(value["fill"]) };
  }
  if (type === "circle") return { ...common, type, ...xy, radius: integer(value["radius"], 1, 512), fill: bool(value["fill"]) };
  if (type === "image") return { ...common, type, ...xy, resourceId: string(value["resourceId"], 80), transparent: bool(value["transparent"]) };
  if (type === "ascii" || type === "chinese") {
    const align = value["align"];
    if (align !== "left" && align !== "center" && align !== "right") throw new Error("文字对齐方式无效");
    const text = string(value["text"], 16384);
    if (type === "ascii" && /[^\x20-\x7e\n]/.test(text)) throw new Error("ASCII 文字只接受可打印 ASCII 和换行");
    return { ...common, type, ...xy, align, text, fontId: string(value["fontId"], 80),
      lineGap: integer(value["lineGap"], 0, 128), transparent: bool(value["transparent"]) };
  }
  throw new Error("不支持的组件类型");
}
export function parseProject(input: unknown, resources: Resource[]): Project {
  const value = object(input);
  if (value["schemaVersion"] !== 1) throw new Error("不支持的项目版本，请使用兼容的设计器；未覆盖当前项目");
  const display = object(value["display"]), rotation = display["rotation"], coordinateBits = display["coordinateBits"], bufferMode = display["bufferMode"];
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) throw new Error("屏幕方向无效");
  if (coordinateBits !== 8 && coordinateBits !== 16) throw new Error("坐标位宽无效");
  if (bufferMode !== "full" && bufferMode !== "page") throw new Error("缓冲方式无效");
  const pages = list(value["pages"], 1000).map(inputPage => {
    const page = object(inputPage);
    return { id: identifier(page["id"]), name: string(page["name"]),
      ...(page["codeName"] === undefined ? {} : { codeName: parsePageCodeName(page["codeName"]) }), background: bit(page["background"]),
      components: list(page["components"], 10000).map(parseComponent) };
  });
  if (!pages.length) throw new Error("项目至少需要一个页面");
  pageCodeNames(pages);
  const project: Project = { schemaVersion: 1, id: identifier(value["id"]), name: string(value["name"]), description: string(value["description"]),
    createdAt: string(value["createdAt"], 40), modifiedAt: string(value["modifiedAt"], 40), pages,
    defaultPageId: identifier(value["defaultPageId"]), resources,
    display: { width: integer(display["width"], 1, 512), height: integer(display["height"], 1, 512),
      rotation, coordinateBits, bufferMode, controller: string(display["controller"]) } };
  if (!pages.some(page => page.id === project.defaultPageId)) throw new Error("默认页面不存在");
  const ids = [project.id, ...pages.flatMap(page => [page.id, ...page.components.map(component => component.id)]), ...resources.map(resource => resource.id)];
  if (new Set(ids).size !== ids.length) throw new Error("项目包含重复 ID");
  validateResourceBudget(resources);
  for (const resource of resources) validateResource(resource);
  for (const page of pages) for (const component of page.components) {
    if (component.type === "image" && component.resourceId && !resources.some(resource => resource.id === component.resourceId && resource.kind === "image")) throw new Error("图片资源引用不存在");
    if ((component.type === "ascii" || component.type === "chinese") && component.fontId &&
        !builtinFonts.some(font => font.id === component.fontId) && !resources.some(resource => resource.id === component.fontId && resource.kind === "font")) throw new Error("字库引用不存在");
  }
  return project;
}
export function validateResourceBudget(resources: readonly Resource[]): void {
  if (resources.length > 10000 || resources.reduce((total, resource) => total + resource.data.length + (resource.source?.length ?? 0), 0) > 128 * 1024 * 1024)
    throw new Error("项目资源超过 10,000 个或 128 MiB 总处理预算");
}
export function validateResource(resource: Resource): void {
  identifier(resource.id); string(resource.name); string(resource.license);
  if (resource.sourceName !== undefined) string(resource.sourceName);
  if (builtinFonts.some(font => font.id === resource.id)) throw new Error("资源 ID 与内置字库标识冲突");
  if (!(resource.data instanceof Uint8Array)) throw new Error("资源必须是字节数据");
  if (resource.source && (!(resource.source instanceof Uint8Array) || resource.source.length > 32 * 1024 * 1024)) throw new Error("源资源超过 32 MiB");
  if (resource.kind === "image") {
    integer(resource.width, 1, 512); integer(resource.height, 1, 512);
    if (resource.data.length !== Math.ceil(resource.width / 8) * resource.height) throw new Error("图片数据长度不匹配");
    if (resource.width % 8) for (let y = 0; y < resource.height; y++) {
      if (resource.data[(y + 1) * Math.ceil(resource.width / 8) - 1]! >> (resource.width % 8)) throw new Error("图片行尾未使用位必须为零");
    }
    if (resource.options) {
      const o = resource.options;
      integer(o.x, 0, 32768); integer(o.y, 0, 32768); integer(o.cropWidth, 1, 32768); integer(o.cropHeight, 1, 32768);
      integer(o.width, 1, 512); integer(o.height, 1, 512); integer(o.threshold, 0, 255);
      bit(o.background); bool(o.invert); bool(o.dither);
      if (o.width !== resource.width || o.height !== resource.height) throw new Error("图片参数尺寸不一致");
    }

  } else if (resource.kind === "font") {
    const coverage = inspectFont(resource.data);
    if (coverage.join(",") !== resource.coverage.join(",")) throw new Error("字库覆盖清单与真实字节不符");
    if (resource.size !== undefined) integer(resource.size, 5, 64);
    if (resource.threshold !== undefined) integer(resource.threshold, 0, 255);
  } else throw new Error("资源类型不支持");
}
export function parseResource(input: unknown, data: Uint8Array, source?: Uint8Array): Resource {
  const value = object(input);
  const common: ResourceCommon = { id: identifier(value["id"]), name: string(value["name"]), license: string(value["license"]), data };
  if (value["sourceName"] !== undefined) common.sourceName = string(value["sourceName"]);
  if (value["kind"] === "image") {
    const resource: Resource = { ...common, kind: "image", width: integer(value["width"], 1, 512), height: integer(value["height"], 1, 512) };
    if (source) resource.source = source;
    if (value["sourceType"] !== undefined) resource.sourceType = string(value["sourceType"], 128);
    if (value["options"] !== undefined) {
      const o = object(value["options"]);
      resource.options = { x: integer(o["x"], 0, 32768), y: integer(o["y"], 0, 32768),
        cropWidth: integer(o["cropWidth"], 1, 32768), cropHeight: integer(o["cropHeight"], 1, 32768),
        width: integer(o["width"], 1, 512), height: integer(o["height"], 1, 512), threshold: integer(o["threshold"], 0, 255),
        invert: bool(o["invert"]), background: bit(o["background"]), dither: bool(o["dither"]) };
    }
    validateResource(resource); return resource;
  }
  if (value["kind"] === "font") {
    const resource: Resource = { ...common, kind: "font", coverage: list(value["coverage"], 65535).map(code => integer(code, 0, 65535)) };
    if (source) resource.source = source;
    if (value["postscriptName"] !== undefined) resource.postscriptName = string(value["postscriptName"]);
    if (value["size"] !== undefined) resource.size = integer(value["size"], 5, 64);
    if (value["threshold"] !== undefined) resource.threshold = integer(value["threshold"], 0, 255);
    validateResource(resource); return resource;
  }
  throw new Error("不支持的资源类型");
}
