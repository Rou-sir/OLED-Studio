import { allocate, assertGlyphs, pixels, withText } from "./runtime";
import type { RendererModule } from "./runtime";
import { builtinFonts, logicalSize } from "./project";
import type { Component, Project, Page } from "./project";
import { arcAngles, widgetOperations } from "./widget-geometry";

export interface Bounds { x: number; y: number; width: number; height: number }
export class ProjectRenderer {
  private buffers = new Map<Uint8Array, number>();
  readonly module: RendererModule;
  constructor(module: RendererModule) { this.module = module; }
  dispose(): void {
    for (const pointer of this.buffers.values()) this.module._free(pointer);
    this.buffers.clear();
  }
  private pointer(bytes: Uint8Array): number {
    let pointer = this.buffers.get(bytes);
    if (pointer === undefined) { pointer = allocate(this.module, bytes); this.buffers.set(bytes, pointer); }
    return pointer;
  }
  private font(project: Project, component: Extract<Component, { type: "ascii" | "chinese" }>): void {
    const builtin = builtinFonts.findIndex(font => font.id === component.fontId);
    if (builtin >= 0) this.module._render_font(builtin, 0);
    else {
      const resource = project.resources.find(resource => resource.id === component.fontId && resource.kind === "font");
      if (!resource) throw new Error("请选择字库");
      this.module._render_font(0, this.pointer(resource.data));
    }
    assertGlyphs(this.module, component.text);
  }
  textLines(project: Project, component: Extract<Component, { type: "ascii" | "chinese" }>): { x: number; baseline: number; text: string; width: number }[] {
    this.font(project, component);
    const ascent = this.module._render_ascent(), descent = this.module._render_descent();
    return component.text.split("\n").map((text, index) => {
      const width = withText(this.module, text, pointer => this.module._render_width(pointer));
      return { text, width, x: component.x - (component.align === "center" ? Math.floor(width / 2) : component.align === "right" ? width : 0),
        baseline: component.y + ascent + index * (ascent - descent + component.lineGap) };
    });
  }
  bounds(project: Project, component: Component): Bounds {
    if ("points" in component) {
      const xs = component.points.map(point => point[0]), ys = component.points.map(point => point[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
    }
    if (component.type === "rect") return { x: component.x, y: component.y, width: component.width, height: component.height };
    if (component.type === "point") return { x: component.x, y: component.y, width: 1, height: 1 };
    if (component.type === "hline" || component.type === "vline") return { x: component.x, y: component.y,
      width: component.type === "hline" ? component.length : 1, height: component.type === "vline" ? component.length : 1 };
    if (component.type === "ellipse") return { x: component.x - component.rx, y: component.y - component.ry, width: component.rx * 2 + 1, height: component.ry * 2 + 1 };
    if (component.type === "arc" || component.type === "sector") return { x: component.x - component.radius, y: component.y - component.radius,
      width: component.radius * 2 + 1, height: component.radius * 2 + 1 };
    if (component.type === "progress" || component.type === "battery") return { x: component.x, y: component.y, width: component.width, height: component.height };
    if (component.type === "circle") return { x: component.x - component.radius, y: component.y - component.radius, width: component.radius * 2 + 1, height: component.radius * 2 + 1 };
    if (component.type === "image") {
      const image = project.resources.find(resource => resource.id === component.resourceId && resource.kind === "image");
      return { x: component.x, y: component.y, width: image?.kind === "image" ? image.width : 16, height: image?.kind === "image" ? image.height : 16 };
    }
    const lines = this.textLines(project, component);
    const x = Math.min(...lines.map(line => line.x));
    return { x, y: component.y, width: Math.max(1, ...lines.map(line => line.x + line.width - x)),
      height: Math.max(1, this.module._render_ascent() - this.module._render_descent()) * lines.length + component.lineGap * (lines.length - 1) };
  }
  draw(project: Project, component: Component): void {
    const m = this.module;
    m._render_color(component.bit);
    switch (component.type) {
      case "point": m._render_pixel(component.x, component.y); break;
      case "hline": case "vline": m._render_hvline(component.x, component.y, component.length, +(component.type === "vline")); break;
      case "ellipse": m._render_ellipse(component.x, component.y, component.rx, component.ry, +component.fill); break;
      case "arc": m._render_arc(component.x, component.y, component.radius, ...arcAngles(component.startAngle, component.sweepAngle)); break;
      case "progress": case "battery": case "sector":
        for (const op of widgetOperations(component)) {
          switch (op.type) {
            case "color": m._render_color(op.bit); break;
            case "box": case "frame": m._render_rect(op.x, op.y, op.width, op.height, +(op.type === "box")); break;
            case "line": m._render_line(op.x, op.y, op.x1, op.y1); break;
            case "triangle": m._render_triangle(...op.points, 1); break;
            case "disc": m._render_circle(op.x, op.y, op.radius, 1); break;
          }
        }
        break;
      case "line": m._render_line(...component.points[0], ...component.points[1]); break;
      case "rect":
        if (component.radius) m._render_round_rect(component.x, component.y, component.width, component.height, component.radius, +component.fill);
        else m._render_rect(component.x, component.y, component.width, component.height, +component.fill);
        break;
      case "circle": m._render_circle(component.x, component.y, component.radius, +component.fill); break;
      case "triangle": m._render_triangle(...component.points[0], ...component.points[1], ...component.points[2], +component.fill); break;
      case "polygon": {
        const coordinates = new Int16Array(component.points.flat());
        const pointer = allocate(m, new Uint8Array(coordinates.buffer));
        try { if (!m._render_polygon(pointer, component.points.length, +component.fill)) throw new Error("原生多边形绘制拒绝该顶点数据"); }
        finally { m._free(pointer); }
        break;
      }
      case "image": {
        const image = project.resources.find(resource => resource.id === component.resourceId && resource.kind === "image");
        if (!image || image.kind !== "image") throw new Error("请选择图片资源");
        m._render_bitmap(component.x, component.y, image.width, image.height, this.pointer(image.data), +component.transparent);
        break;
      }
      case "ascii": case "chinese":
        for (const line of this.textLines(project, component)) withText(m, line.text, pointer => m._render_text(line.x, line.baseline, pointer, +component.transparent));
        break;
    }
  }
  render(project: Project, page: Page, paged = false): { pixels: Uint8Array; errors: string[] } {
    const [width, height] = logicalSize(project), m = this.module;
    const live = new Set(project.resources.map(resource => resource.data));
    for (const [data, pointer] of this.buffers) if (!live.has(data)) { m._free(pointer); this.buffers.delete(data); }
    if (!m._render_init(width, height, paged ? 1 : 0)) throw new Error("原生画布参数不支持");
    const errors = new Set<string>();
    for (let row = 0; row < (paged ? Math.ceil(height / 8) : 1); row++) {
      if (paged) m._render_page(row);
      m._render_color(page.background); m._render_rect(0, 0, width, height, 1);
      for (const component of page.components) if (component.visible) {
        try { this.draw(project, component); }
        catch (error) { errors.add(`${page.name} / ${component.name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      m._render_pixels();
    }
    return { pixels: pixels(m, width, height), errors: [...errors] };
  }
}
