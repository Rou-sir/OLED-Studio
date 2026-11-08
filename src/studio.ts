import { createProject, createComponent, id, snapshot, parseProject, parseComponent, builtinFonts, logicalSize, moveComponent, pageCodeNames, nextPageCodeName, nextComponentName } from "./project";
import type { Project, Component, Page } from "./project";
import { History } from "./history";
import { Persistence } from "./persistence";
import { packProject, unpackProject } from "./project-package";
import { ProjectRenderer } from "./project-renderer";
import type { Bounds } from "./project-renderer";
import { element, node, button, field, download, showPixels } from "./ui";
import { resourceManager } from "./resource-ui";
import { exportProject, exportTargets, parseExportTarget } from "./export";
import { unpackXbm } from "./bitmap";

let history = new History(createProject()), pageId = history.project.defaultPageId;
let renderer: ProjectRenderer, ready = false, selection = new Set<string>(), zoom = 5;
let clipboard: Component[] = [], saveTimer: ReturnType<typeof setTimeout> | undefined;
let packageJob: AbortController | undefined;
let homeVisible = true, hasProject = false, homeGeneration = 0, renameId: string | undefined;
let lastPixels: Uint8Array = new Uint8Array(), diagnostics: string[] = [], warnings: string[] = [];
let previewColor: readonly [number, number, number] = [235, 235, 235];
const pageViews = new Map<string, { zoom: number; left: number; top: number }>();
const canvas = element<HTMLCanvasElement>("#pixels"), overlay = element<HTMLCanvasElement>("#overlay");
function notify(message: string, error = false): void { const status = element("#notice"); status.textContent = message; status.className = error ? "error" : ""; }
const fail = (error: unknown) => notify(error instanceof Error ? error.message : String(error), true);
const editorLayout = element("#editor-layout");
let panelWidths: { left: number; right: number } | undefined;
function resizePanels(side?: "left" | "right", value?: number): void {
  const width = editorLayout.clientWidth;
  if (!width) return;
  const defaults = width <= 760 ? { left: 180, right: 220 } :
    width <= 1100 ? { left: 204, right: 234 } : { left: 224, right: 264 };
  const widths = { ...(panelWidths ?? defaults) };
  const budget = Math.max(400, width - 292);
  if (side && value !== undefined) {
    const other = side === "left" ? "right" : "left";
    widths[side] = Math.round(Math.max(side === "left" ? 180 : 220,
      Math.min(value, side === "left" ? 420 : 480, budget - widths[other])));
    panelWidths = widths;
  } else {
    widths.left = Math.max(180, Math.min(widths.left, budget - 220));
    widths.right = Math.max(220, Math.min(widths.right, budget - widths.left));
  }
  for (const key of ["left", "right"] as const) {
    editorLayout.style.setProperty(`--${key}-width`, `${widths[key]}px`);
    const handle = element(`#${key}-resizer`);
    handle.setAttribute("aria-valuemin", String(key === "left" ? 180 : 220));
    handle.setAttribute("aria-valuemax", String(Math.min(key === "left" ? 420 : 480,
      budget - widths[key === "left" ? "right" : "left"])));
    handle.setAttribute("aria-valuenow", String(widths[key]));
  }
}
for (const side of ["left", "right"] as const) {
  const handle = element(`#${side}-resizer`);
  let gesture: { pointerId: number; x: number; width: number } | undefined;
  const finish = (): void => {
    if (!gesture) return;
    const pointerId = gesture.pointerId; gesture = undefined;
    handle.classList.remove("resizing"); document.body.classList.remove("resizing-panels");
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  };
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || gesture) return;
    event.preventDefault();
    gesture = { pointerId: event.pointerId, x: event.clientX,
      width: element(`#${side}-panel`).getBoundingClientRect().width };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("resizing"); document.body.classList.add("resizing-panels");
  });
  handle.addEventListener("pointermove", event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    resizePanels(side, gesture.width + (event.clientX - gesture.x) * (side === "left" ? 1 : -1));
  });
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
  handle.addEventListener("dblclick", () => { panelWidths = undefined; resizePanels(); });
  handle.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const current = Number(handle.getAttribute("aria-valuenow"));
    const value = event.key === "Home" ? Number(handle.getAttribute("aria-valuemin")) :
      event.key === "End" ? Number(handle.getAttribute("aria-valuemax")) :
      current + (event.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1) * (event.shiftKey ? 40 : 10);
    resizePanels(side, value);
  });
}
new ResizeObserver(() => resizePanels()).observe(editorLayout);
const persistence = new Persistence(state => {
  element("#save-state").textContent = `${state.cache} · ${state.disk}${state.busy ? " · 保存中…" : ""}`;
}, fail);
function project(): Project { return history.project; }
function page(): Page { return project().pages.find(value => value.id === pageId) ?? project().pages[0]!; }
function selected(): Component[] { return page().components.filter(component => selection.has(component.id)); }
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = undefined; persistence.save(project()); }, 400);
  element("#save-state").textContent = "存在未保存修改；等待自动保存…";
}
async function flush(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; persistence.save(project()); }
  await persistence.flush();
}
function commit(action: (project: Project) => void): void {
  if (!ready) throw new Error("原生运行时尚未加载");
  try { history.change(action); }
  catch (error) { update(); throw error; }
  update(); scheduleSave();
}
function action(selector: string, callback: () => void | Promise<void>): void {
  element(selector).addEventListener("click", () => {
    void Promise.resolve().then(() => {
      if (!ready) throw new Error("离线运行时尚未加载，请稍候");
      return callback();
    }).catch(fail);
  });
}
function preview(): void {
  if (!ready) return;
  const [width, height] = logicalSize(project()), result = renderer.render(project(), page(), project().display.bufferMode === "page");
  lastPixels = result.pixels; diagnostics = result.errors;
  warnings = [];
  for (const component of page().components) {
    const b = bounds(component);
    if (b.x < 0 || b.y < 0 || b.x + b.width > width || b.y + b.height > height) warnings.push(`裁剪警告：${component.name} 超出 ${width}×${height}，保留坐标并按原生边界裁剪`);
  }
  showPixels(canvas, result.pixels, width, height, previewColor);
  canvas.style.width = `${width * zoom}px`; canvas.style.height = `${height * zoom}px`;
  element("#artboard").style.width = `${width * zoom}px`; element("#artboard").style.height = `${height * zoom}px`;
  overlay.width = width * zoom; overlay.height = height * zoom;
  drawOverlay();
  element("#diagnostics").textContent = [...diagnostics, ...warnings].join("\n");
}
function bounds(component: Component): Bounds {
  try { return renderer.bounds(project(), component); }
  catch (error) {
    const message = `${component.name}: ${error instanceof Error ? error.message : String(error)}`;
    if (!diagnostics.includes(message)) diagnostics.push(message);
    element("#diagnostics").textContent = diagnostics.join("\n");
    // Unbound resources retain an editable anchor; the diagnosed placeholder is never exported.
    return { x: "x" in component ? component.x : 0, y: "y" in component ? component.y : 0, width: 16, height: 16 };
  }
}
function handles(component: Component): [number, number][] {
  if ("points" in component) return component.points.map(([x, y]) => [x, y]);
  if (component.type === "rect") return [[component.x + component.width - 1, component.y + component.height - 1]];
  if (component.type === "circle") return [[component.x + component.radius, component.y]];
  if (component.type === "arc" || component.type === "sector") return [[component.x + component.radius, component.y]];
  if (component.type === "ellipse") return [[component.x + component.rx, component.y + component.ry]];
  if (component.type === "progress" || component.type === "battery") return [[component.x + component.width - 1, component.y + component.height - 1]];
  if (component.type === "hline" || component.type === "vline") return [[component.x + (component.type === "hline" ? component.length - 1 : 0), component.y + (component.type === "vline" ? component.length - 1 : 0)]];
  return [];
}
function drawOverlay(): void {
  const ctx = overlay.getContext("2d"); if (!ctx) throw new Error("无法创建编辑辅助层");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const guideLabels = element("#selection-guides"); guideLabels.replaceChildren();
  guideLabels.hidden = element<HTMLInputElement>("#preview-mode").checked;
  if (element<HTMLInputElement>("#grid").checked && zoom >= 4) {
    ctx.strokeStyle = "#3d658343"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x < overlay.width; x += zoom) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, overlay.height); }
    for (let y = 0; y < overlay.height; y += zoom) { ctx.moveTo(0, y + .5); ctx.lineTo(overlay.width, y + .5); }
    ctx.stroke();
  }
  const boxes = selected().map(bounds);
  if (boxes.length) {
    const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
    const right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
    ctx.save(); ctx.strokeStyle = "#e5d67d"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath();
    for (const x of [left, right]) { ctx.moveTo(x * zoom, 0); ctx.lineTo(x * zoom, overlay.height); }
    for (const y of [top, bottom]) { ctx.moveTo(0, y * zoom); ctx.lineTo(overlay.width, y * zoom); }
    ctx.stroke(); ctx.restore();
    for (const [edge, value] of [["left", left], ["right", right], ["top", top], ["bottom", bottom]] as const) {
      const label = node("span", String(value)); label.dataset.edge = edge; label.dataset.coordinate = String(value);
      label.className = "guide-coordinate";
      label.style.left = edge === "left" || edge === "right" ? `${value * zoom}px` : "-8px";
      label.style.top = edge === "top" || edge === "bottom" ? `${value * zoom}px` : "-8px";
      label.style.transform = edge === "left" || edge === "right" ? "translate(-50%,-100%)" : "translate(-100%,-50%)";
      guideLabels.append(label);
    }
  }
  ctx.strokeStyle = "#54ccff"; ctx.fillStyle = "#54ccff"; ctx.lineWidth = 1.5;
  for (const component of selected()) {
    const b = bounds(component); ctx.strokeRect(b.x * zoom - 1, b.y * zoom - 1, b.width * zoom + 2, b.height * zoom + 2);
    if (!component.locked && selection.size === 1) for (const [x, y] of handles(component)) ctx.fillRect(x * zoom - 4, y * zoom - 4, 8, 8);
  }
}
function update(): void {
  if (!project().pages.some(value => value.id === pageId)) pageId = project().defaultPageId;
  selection = new Set([...selection].filter(value => page().components.some(component => component.id === value)));
  projectProperties(); pagesPanel(); componentsPanel(); propertiesPanel(); preview();
  if (!element("#images-panel").hidden) imagesPanel();
  element("#editor-project-name").textContent = project().name;
  const [width, height] = logicalSize(project());
  element("#editor-display-size").textContent = `${width} × ${height} · ${project().pages.length} 个页面`;
  element("#canvas-page-name").textContent = `${page().name} · ${width} × ${height}`;
  element("#page-count").textContent = String(project().pages.length);
  element("#component-count").textContent = String(page().components.length);
}
function projectProperties(): void {
  const panel = element("#project-properties"); panel.replaceChildren();
  const edit = (key: keyof Project, value: unknown) => commit(current => {
    const parsed = parseProject({ ...current, [key]: value }, current.resources); Object.assign(current, parsed);
  });
  field(panel, "名称", project().name, value => edit("name", value), fail);
  field(panel, "说明", project().description, value => edit("description", value), fail, undefined, true);
  const changeDisplay = (key: keyof Project["display"], value: unknown) => {
    if ((key === "width" || key === "height" || key === "rotation") && !confirm(`更改屏幕参数会影响 ${project().pages.length} 个页面；保留坐标不缩放，越界组件将提示裁剪。继续？`)) return;
    edit("display", { ...project().display, [key]: value });
  };
  const presets = node("div"); presets.className = "buttons";
  for (const [width, height] of [[128,64], [128,32], [128,128]] as const) presets.append(button(`${width}×${height}`, () => {
    if (!confirm(`更改 ${project().pages.length} 个页面的屏幕尺寸？保留坐标不缩放。`)) return;
    edit("display", { ...project().display, width, height });
  }, fail));
  panel.append(presets);
  field(panel, "物理宽", project().display.width, value => changeDisplay("width", value), fail);
  field(panel, "物理高", project().display.height, value => changeDisplay("height", value), fail);
  field(panel, "方向", String(project().display.rotation), value => changeDisplay("rotation", Number(value)), fail,
    [0, 90, 180, 270].map(value => ({ value: String(value), label: `${value}°` })));
  field(panel, "缓冲", project().display.bufferMode, value => changeDisplay("bufferMode", value), fail,
    [{ value: "full", label: "全缓冲" }, { value: "page", label: "页缓冲" }]);
  field(panel, "控制器备注", project().display.controller, value => changeDisplay("controller", value), fail);
  field(panel, "坐标位宽", String(project().display.coordinateBits), value => changeDisplay("coordinateBits", Number(value)), fail,
    [{ value: "16", label: "16 bit 原生预览 / 导出" }, { value: "8", label: "8 bit（当前阻止导出）" }]);
  const [logicalWidth, logicalHeight] = logicalSize(project());
  panel.append(node("small", `逻辑画布 ${logicalWidth}×${logicalHeight} · 理论单色容量 ${Math.ceil(logicalWidth * logicalHeight / 8)} B`));
  panel.append(node("small", "原生预览当前使用 16 位坐标；设备初始化与驱动由调用方配置。"));
}
function pagesPanel(): void {
  const panel = element("#pages"); panel.replaceChildren();
  for (const value of project().pages) {
    const row = node("div"); row.className = "row" + (value.id === page().id ? " selected" : "");
    row.append(button(`${value.id === project().defaultPageId ? "★ " : ""}${value.name}`, () => {
      const viewport = element(".viewport"); pageViews.set(page().id, { zoom, left: viewport.scrollLeft, top: viewport.scrollTop });
      pageId = value.id; const view = pageViews.get(pageId); zoom = view?.zoom ?? 5;
      element<HTMLInputElement>("#zoom").value = String(zoom); selection.clear(); update();
      viewport.scrollLeft = view?.left ?? 0; viewport.scrollTop = view?.top ?? 0;
    }, fail), button("↑", () => {
      commit(current => { const index = current.pages.findIndex(item => item.id === value.id);
        const names = pageCodeNames(current.pages); current.pages.forEach((item, position) => { item.codeName = names[position]!; });
        if (index > 0) [current.pages[index - 1], current.pages[index]] = [current.pages[index]!, current.pages[index - 1]!]; });
    }, fail)); panel.append(row);
  }
}
function componentsPanel(): void {
  const panel = element("#components"); panel.replaceChildren();
  for (const component of [...page().components].reverse()) {
    const row = node("div"); row.className = "row" + (selection.has(component.id) ? " selected" : "");
    const select = node("button", component.name); select.title = component.type;
    select.addEventListener("click", event => { if (!event.shiftKey) selection.clear();
      if (selection.has(component.id)) selection.delete(component.id); else selection.add(component.id);
      componentsPanel(); propertiesPanel(); drawOverlay(); });
    row.append(select, button(component.visible ? "◉" : "○", () => commit(() => { component.visible = !component.visible; }), fail),
      button(component.locked ? "锁" : "开", () => commit(() => { component.locked = !component.locked; }), fail)); panel.append(row);
  }
}
function componentChange(key: string, value: unknown): void {
  commit(() => {
    for (const component of selected()) {
      if (component.locked) continue;
      const parsed = parseComponent({ ...component, [key]: value }); Object.assign(component, parsed);
    }
  });
}
function propertiesPanel(): void {
  const panel = element("#properties"); panel.replaceChildren();
  const components = selected();
  element("#property-kind").textContent = components.length === 1 ? components[0]!.type.toUpperCase() : components.length > 1 ? "多选" : "页面";
  if (!components.length) {
    const value = page();
    field(panel, "页面名称", value.name, name => commit(() => { value.name = String(name); }), fail);
    const codeName = pageCodeNames(project().pages)[project().pages.indexOf(value)]!;
    field(panel, "代码名称", codeName, name => {
      const candidate = String(name).trim();
      const resolved = pageCodeNames(project().pages);
      pageCodeNames(project().pages.map((current, index) => ({ ...current,
        codeName: current.id === value.id ? candidate : resolved[index]! })));
      commit(current => {
        const names = pageCodeNames(current.pages);
        current.pages.forEach((item, index) => { item.codeName = item.id === value.id ? candidate : names[index]!; });
      });
    }, fail);
    panel.append(node("small", `导出函数 oled_ui_page_${codeName}；英文、数字、下划线，字母开头，项目内唯一。`));
    field(panel, "背景白色", !!value.background, white => commit(() => { value.background = white ? 1 : 0; }), fail);
    panel.append(button("设为默认页面", () => commit(current => { current.defaultPageId = value.id; }), fail));
    panel.append(node("p", "选择组件以编辑属性。")); return;
  }
  if (components.length > 1) { panel.append(node("p", `已选择 ${components.length} 个组件；可整体移动、复制、删除或对齐。`)); return; }
  const component = components[0]!;
  field(panel, "名称", component.name, value => componentChange("name", value), fail);
  field(panel, "可见", component.visible, value => componentChange("visible", value), fail);
  field(panel, "锁定", component.locked, value => commit(() => { component.locked = !!value; }), fail);
  field(panel, "白色像素", !!component.bit, value => componentChange("bit", value ? 1 : 0), fail);
  if ("x" in component) {
    field(panel, "X", component.x, value => componentChange("x", value), fail);
    field(panel, "Y", component.y, value => componentChange("y", value), fail);
  }
  if ("points" in component) {
    const vertex = field(panel, "顶点 x,y；逐行", component.points.map(point => point.join(",")).join("\n"),
      value => {
        const points = String(value).split("\n").map(line => line.trim().split(",").map(part => Number(part.trim())));
        componentChange("points", points);
      }, fail, undefined, true);
    vertex.title = "至少三个合法简单多边形顶点；线段两点。可在画布拖动控制点。";
  }
  if (component.type === "rect" || component.type === "progress" || component.type === "battery") {
    field(panel, "宽", component.width, value => componentChange("width", value), fail);
    field(panel, "高", component.height, value => componentChange("height", value), fail);
  }
  if ("radius" in component) field(panel, "半径", component.radius, value => componentChange("radius", value), fail);
  if ("fill" in component) field(panel, "填充", component.fill, value => componentChange("fill", value), fail);
  if ("length" in component) field(panel, "长度", component.length, value => componentChange("length", value), fail);
  if (component.type === "ellipse") {
    field(panel, "水平半径", component.rx, value => componentChange("rx", value), fail);
    field(panel, "垂直半径", component.ry, value => componentChange("ry", value), fail);
  }
  if (component.type === "arc" || component.type === "sector") {
    field(panel, "起始角度", component.startAngle, value => componentChange("startAngle", value), fail);
    field(panel, "扫过角度", component.sweepAngle, value => componentChange("sweepAngle", value), fail);
    panel.append(node("small", "0° 朝右，逆时针；扫过 1–360°。圆弧角度按 U8g2 256 级量化；扇形为 3° 内三角形分段。"));
  }
  if (component.type === "progress") {
    field(panel, "最小值", component.min, value => componentChange("min", value), fail);
    field(panel, "最大值", component.max, value => componentChange("max", value), fail);
    field(panel, "当前值", component.value, value => componentChange("value", value), fail);
    field(panel, "纵向", component.vertical, value => componentChange("vertical", value), fail);
    field(panel, "边框", component.border, value => componentChange("border", value), fail);
    panel.append(node("small", "横向从左向右，纵向从下向上填充。当前阶段值为静态属性。"));
  }
  if (component.type === "battery") {
    field(panel, "电量 %", component.value, value => componentChange("value", value), fail);
    field(panel, "充电闪电", component.charging, value => componentChange("charging", value), fail);
  }
  if ("transparent" in component) field(panel, "透明背景", component.transparent, value => componentChange("transparent", value), fail);
  if (component.type === "ascii" || component.type === "chinese") {
    field(panel, "文字", component.text, value => componentChange("text", value), fail, undefined, true);
    field(panel, "字库 / 原生尺寸", component.fontId, value => componentChange("fontId", value), fail,
      [{ value: "", label: "请选择字库" }, ...builtinFonts.map(font => ({ value: font.id, label: `ASCII ${font.name} · ${font.symbol}` })),
        ...project().resources.filter(resource => resource.kind === "font").map(resource => ({ value: resource.id, label: resource.name }))]);
    field(panel, "对齐", component.align, value => componentChange("align", value), fail,
      [{ value: "left", label: "左" }, { value: "center", label: "中" }, { value: "right", label: "右" }]);
    field(panel, "行间距", component.lineGap, value => componentChange("lineGap", value), fail);
    panel.append(node("small", "X 是对齐锚点，Y 是字库 ascent 对齐后的顶部；不缩放压缩字库像素。"));
  }
  if (component.type === "image") field(panel, "图片资源", component.resourceId, value => componentChange("resourceId", value), fail,
    [{ value: "", label: "请选择图片" }, ...project().resources.filter(resource => resource.kind === "image").map(resource => ({ value: resource.id, label: resource.name }))]);
}
const typeNames: Record<Component["type"], string> = { line: "线条", rect: "矩形", circle: "圆", triangle: "三角形", polygon: "多边形", ascii: "ASCII", chinese: "中文", image: "图片",
  point: "点", hline: "水平线", vline: "垂直线", ellipse: "椭圆", arc: "圆弧", sector: "扇形", progress: "进度条", battery: "电池" };
element("#component-type-count").textContent = `${Object.keys(typeNames).length} TYPES`;
for (const type of Object.keys(typeNames) as Component["type"][]) element("#component-tools").append(button(typeNames[type], () => {
  const component = createComponent(type); component.name = nextComponentName(page().components, type);
  if (component.type === "chinese") component.fontId = project().resources.find(resource => resource.kind === "font")?.id ?? "";
  if (component.type === "image") component.resourceId = project().resources.find(resource => resource.kind === "image")?.id ?? "";
  selection = new Set([component.id]); commit(() => page().components.push(component));
}, fail));
action("#new-page", () => commit(current => {
  const names = pageCodeNames(current.pages); current.pages.forEach((item, index) => { item.codeName = names[index]!; });
  const newPage = { id: id(), name: `页面 ${current.pages.length + 1}`, codeName: nextPageCodeName(current.pages), background: 0 as const, components: [] };
  current.pages.push(newPage); pageId = newPage.id; selection.clear();
}));
action("#copy-page", () => commit(current => {
  const names = pageCodeNames(current.pages); current.pages.forEach((item, index) => { item.codeName = names[index]!; });
  const copy = structuredClone(page()); copy.id = id(); copy.name += " 副本"; copy.codeName = nextPageCodeName(current.pages); copy.components.forEach(component => { component.id = id(); });
  current.pages.push(copy); pageId = copy.id; selection.clear();
}));
action("#delete-page", () => {
  if (project().pages.length <= 1) throw new Error("至少保留一个页面");
  if (!confirm("删除当前页面及其组件？")) return;
  commit(current => {
    const names = pageCodeNames(current.pages); current.pages.forEach((item, index) => { item.codeName = names[index]!; });
    current.pages = current.pages.filter(value => value.id !== page().id);
    if (!current.pages.some(value => value.id === current.defaultPageId)) current.defaultPageId = current.pages[0]!.id;
    pageId = current.defaultPageId; selection.clear(); });
});
function copy(): void { clipboard = structuredClone(selected()); }
function paste(): void {
  if (!clipboard.length) return;
  commit(() => { const copies = structuredClone(clipboard).map(component => {
    component.id = id(); component.locked = false; moveComponent(component, 3, 3); return parseComponent(component);
  });
    page().components.push(...copies); selection = new Set(copies.map(component => component.id)); });
}
function remove(): void { commit(() => { page().components = page().components.filter(component => !selection.has(component.id) || component.locked); selection.clear(); }); }
action("#copy-component", () => { copy(); paste(); }); action("#delete-component", remove);
function layer(direction: 1 | -1): void {
  commit(() => { const components = page().components, order = direction === 1 ? [...components].reverse() : [...components];
    for (const component of order) if (selection.has(component.id) && !component.locked) {
      const index = components.indexOf(component), target = index + direction;
      if (target >= 0 && target < components.length && !selection.has(components[target]!.id)) [components[index], components[target]] = [components[target]!, component];
    }
  });
}
action("#layer-up", () => layer(1)); action("#layer-down", () => layer(-1));
for (const [text, top] of [["置顶", true], ["置底", false]] as const) element("#layer-up").parentElement!.append(button(text, () => {
  commit(() => { const moving = page().components.filter(component => selection.has(component.id) && !component.locked);
    const rest = page().components.filter(component => !moving.includes(component)); page().components = top ? [...rest, ...moving] : [...moving, ...rest]; });
}, fail));
function undo(): void { if (history.undo()) { update(); scheduleSave(); } }
function redo(): void { if (history.redo()) { update(); scheduleSave(); } }
action("#undo", undo); action("#redo", redo);
function align(axis: "x" | "y", position: "start" | "center" | "end" = "start"): void {
  const components = selected().filter(component => !component.locked); if (components.length < 2) throw new Error("请选择至少两个未锁定组件");
  const anchor = (b: Bounds) => b[axis] + (position === "start" ? 0 : (axis === "x" ? b.width : b.height) * (position === "end" ? 1 : .5));
  const anchors = components.map(component => anchor(bounds(component)));
  const target = position === "start" ? Math.min(...anchors) : position === "end" ? Math.max(...anchors) : anchors[0]!;
  commit(() => components.forEach(component => { const delta = Math.round(target - anchor(bounds(component))); moveComponent(component, axis === "x" ? delta : 0, axis === "y" ? delta : 0); }));
}
action("#align-left", () => align("x")); action("#align-top", () => align("y"));
for (const [label, axis, position] of [["水平居中", "x", "center"], ["右对齐", "x", "end"], ["垂直居中", "y", "center"], ["底对齐", "y", "end"]] as const)
  element("#alignment-tools").append(button(label, () => {
    align(axis, position); element<HTMLDetailsElement>(".toolbar-menu").open = false;
  }, fail));
let pan: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
const viewport = element(".viewport");
viewport.addEventListener("pointerdown", event => {
  if (event.button !== 1) return;
  event.preventDefault(); pan = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId);
});
viewport.addEventListener("pointermove", event => {
  if (!pan || pan.pointer !== event.pointerId) return;
  viewport.scrollLeft = pan.left - (event.clientX - pan.x); viewport.scrollTop = pan.top - (event.clientY - pan.y);
});
viewport.addEventListener("pointerup", () => { pan = undefined; });
viewport.addEventListener("pointercancel", () => { pan = undefined; });
function setZoom(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error("缩放倍率须为 1–20");
  zoom = value; element<HTMLInputElement>("#zoom").value = String(zoom); preview();
}
element("#zoom").addEventListener("change", () => { try { setZoom(Number(element<HTMLInputElement>("#zoom").value)); } catch (error) { fail(error); } });
element("#grid").addEventListener("change", drawOverlay);
element("#preview-mode").addEventListener("change", () => { overlay.hidden = element<HTMLInputElement>("#preview-mode").checked; drawOverlay(); });
element("#preview-color").addEventListener("input", () => {
  const value = element<HTMLInputElement>("#preview-color").value;
  if (!/^#[0-9a-f]{6}$/i.test(value)) { fail(new Error("预览颜色必须是有效的 RGB 颜色")); return; }
  previewColor = [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
  showPixels(canvas, lastPixels, canvas.width, canvas.height, previewColor);
});
element("#reset-preview-color").addEventListener("click", () => {
  element<HTMLInputElement>("#preview-color").value = "#ebebeb";
  previewColor = [235, 235, 235];
  showPixels(canvas, lastPixels, canvas.width, canvas.height, previewColor);
});
overlay.addEventListener("wheel", event => { event.preventDefault(); try { setZoom(Math.min(20, Math.max(1, zoom + (event.deltaY < 0 ? 1 : -1)))); } catch (error) { fail(error); } }, { passive: false });
interface Drag { before: Project; x: number; y: number; ids: string[]; componentId?: string; handle?: number; pointer: number; changed: boolean }
let drag: Drag | undefined;
let marquee: { x: number; y: number; endX: number; endY: number; pointer: number; previous: Set<string> } | undefined;
function location(event: PointerEvent): [number, number] {
  const rect = overlay.getBoundingClientRect(); return [Math.round((event.clientX - rect.left) / zoom), Math.round((event.clientY - rect.top) / zoom)];
}
overlay.addEventListener("pointerdown", event => {
  if (!ready || event.button !== 0) return;
  try {
    const [x, y] = location(event), component = selected()[0];
    let handle = -1;
    if (selection.size === 1 && component && !component.locked) handle = handles(component).findIndex(([hx, hy]) => Math.hypot((hx - x) * zoom, (hy - y) * zoom) <= 7);
    if (handle >= 0 && component) {
      drag = { before: snapshot(project()), x, y, ids: [component.id], componentId: component.id, handle, pointer: event.pointerId, changed: false };
    } else {
      const hit = [...page().components].reverse().find(component => {
        if (!component.visible) return false;
        const b = bounds(component); return x >= b.x - 2 && y >= b.y - 2 && x < b.x + b.width + 2 && y < b.y + b.height + 2;
      });
      if (!hit) {
        marquee = { x, y, endX: x, endY: y, pointer: event.pointerId, previous: event.shiftKey ? new Set(selection) : new Set() };
        selection = new Set(marquee.previous); overlay.setPointerCapture(event.pointerId); componentsPanel(); propertiesPanel(); drawOverlay(); return;
      }
      if (event.shiftKey) { if (selection.has(hit.id)) selection.delete(hit.id); else selection.add(hit.id); }
      else if (!selection.has(hit.id)) selection = new Set([hit.id]);
      drag = { before: snapshot(project()), x, y, ids: selected().filter(component => !component.locked).map(component => component.id), pointer: event.pointerId, changed: false };
    }
    overlay.setPointerCapture(event.pointerId); componentsPanel(); propertiesPanel(); drawOverlay();
  } catch (error) { fail(error); }
});
overlay.addEventListener("pointermove", event => {
  if (marquee && marquee.pointer === event.pointerId) {
    [marquee.endX, marquee.endY] = location(event); drawOverlay();
    const ctx = overlay.getContext("2d");
    if (ctx) { ctx.strokeStyle = "#66e3c4"; ctx.strokeRect(marquee.x * zoom, marquee.y * zoom, (marquee.endX - marquee.x) * zoom, (marquee.endY - marquee.y) * zoom); }
    return;
  }
  if (!drag || drag.pointer !== event.pointerId) return;
  try {
    const activeDrag = drag;
    const [x, y] = location(event), snap = element<HTMLInputElement>("#snap-enabled").checked ? Number(element<HTMLInputElement>("#snap").value) : 1;
    if (!Number.isInteger(snap) || snap < 1 || snap > 32) throw new Error("吸附单位须为 1–32");
    const dx = Math.round((x - activeDrag.x) / snap) * snap, dy = Math.round((y - activeDrag.y) / snap) * snap;
    const sourcePage = activeDrag.before.pages.find(value => value.id === page().id)!;
    const candidates = activeDrag.ids.map(componentId => {
      const original = sourcePage.components.find(value => value.id === componentId)!;
      const candidate = structuredClone(original);
      if (activeDrag.handle !== undefined && activeDrag.componentId === componentId) {
        if ("points" in candidate && "points" in original) candidate.points[activeDrag.handle] = [original.points[activeDrag.handle]![0] + dx, original.points[activeDrag.handle]![1] + dy];
        else if (candidate.type === "rect") { candidate.width = Math.max(1, x - candidate.x + 1); candidate.height = Math.max(1, y - candidate.y + 1); candidate.radius = Math.min(candidate.radius, Math.floor(Math.min(candidate.width, candidate.height) / 2)); }
        else if (candidate.type === "circle") candidate.radius = Math.max(1, Math.round(Math.hypot(x - candidate.x, y - candidate.y)));
        else if (candidate.type === "arc" || candidate.type === "sector") candidate.radius = Math.max(1, Math.round(Math.hypot(x - candidate.x, y - candidate.y)));
        else if (candidate.type === "ellipse") { candidate.rx = Math.max(1, x - candidate.x); candidate.ry = Math.max(1, y - candidate.y); }
        else if (candidate.type === "progress" || candidate.type === "battery") {
          candidate.width = Math.max(candidate.type === "battery" ? 8 : 3, x - candidate.x + 1);
          candidate.height = Math.max(candidate.type === "battery" ? 7 : 3, y - candidate.y + 1);
        }
        else if (candidate.type === "hline" || candidate.type === "vline") candidate.length = Math.max(1, candidate.type === "hline" ? x - candidate.x + 1 : y - candidate.y + 1);
      } else moveComponent(candidate, dx, dy);
      return parseComponent(candidate);
    });
    for (const candidate of candidates) Object.assign(page().components.find(value => value.id === candidate.id)!, candidate);
    drag.changed = dx !== 0 || dy !== 0; preview();
  } catch (error) { fail(error); }
});
function finishDrag(cancel = false): void {
  if (marquee) {
    const m = marquee; marquee = undefined; selection = new Set(m.previous);
    if (!cancel) for (const component of page().components) {
      if (!component.visible) continue;
      const b = bounds(component);
      if (b.x <= Math.max(m.x, m.endX) && b.x + b.width >= Math.min(m.x, m.endX) &&
          b.y <= Math.max(m.y, m.endY) && b.y + b.height >= Math.min(m.y, m.endY)) selection.add(component.id);
    }
    componentsPanel(); propertiesPanel(); drawOverlay(); return;
  }
  if (!drag) return;
  if (cancel) history.project = drag.before;
  else if (drag.changed) { history.commit(drag.before); scheduleSave(); }
  drag = undefined; update();
}
overlay.addEventListener("pointerup", () => finishDrag());
overlay.addEventListener("pointercancel", () => finishDrag(true));
document.addEventListener("keydown", event => {
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (event.repeat) return;
    if (!ready) { fail(new Error("运行时尚未加载，无法保存项目")); return; }
    if (!hasProject) { notify("请先新建或打开项目再保存"); return; }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) event.target.blur();
    void (async () => {
      if (drag || marquee) finishDrag();
      await flush(); persistence.save(project()); await persistence.flush();
      notify("已执行项目保存；缓存和磁盘结果请查看保存状态。未提交的资源配置不会自动加入项目。");
    })().catch(fail);
    return;
  }
  if (!ready || homeVisible || document.querySelector("dialog[open]") || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  try {
    if (event.key === "Escape" && (drag || marquee)) { finishDrag(true); return; }
    if (drag || marquee) return;
    if (event.ctrlKey && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    else if (event.ctrlKey && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    else if (event.ctrlKey && event.key.toLowerCase() === "c") { event.preventDefault(); copy(); }
    else if (event.ctrlKey && event.key.toLowerCase() === "v") { event.preventDefault(); paste(); }
    else if (event.key === "Delete") { event.preventDefault(); remove(); }
    else if (event.key.startsWith("Arrow")) {
      event.preventDefault(); const step = event.shiftKey ? 10 : 1;
      commit(() => selected().filter(component => !component.locked).forEach(component => {
        const candidate = structuredClone(component); moveComponent(candidate, event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0, event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0);
        Object.assign(component, parseComponent(candidate));
      }));
    }
  } catch (error) { fail(error); }
});
function replace(project: Project): void {
  if (drag || marquee) finishDrag(true);
  history = new History(project); pageId = project.defaultPageId; selection.clear(); clipboard = []; pageViews.clear(); update();
}
function enterEditor(): void {
  homeGeneration++; homeVisible = false; hasProject = true;
  element("#home-view").hidden = true; element("#editor-view").hidden = false;
  element<HTMLDialogElement>("#settings-dialog").close();
  element<HTMLDetailsElement>(".toolbar-menu").open = false;
  update(); element("#project-library").focus();
}
async function showHome(): Promise<void> {
  if (drag || marquee) finishDrag(true);
  await flush();
  homeVisible = true; element("#editor-view").hidden = true; element("#home-view").hidden = false;
  await renderHome();
}
async function renderHome(): Promise<void> {
  const generation = ++homeGeneration, entries = await persistence.listProjects();
  if (!homeVisible || generation !== homeGeneration) return;
  if (hasProject && !entries.some(entry => entry.id === project().id))
    entries.unshift({ id: project().id, name: project().name, modifiedAt: project().modifiedAt });
  const list = element("#project-list"); list.replaceChildren();
  element("#project-count").textContent = `${entries.length} 个本地项目`;
  if (!entries.length) {
    const empty = node("div"); empty.className = "empty-library";
    empty.append(node("strong", "还没有项目"), node("p", "新建项目开始设计，或导入已有项目包。")); list.append(empty);
    return;
  }
  const thumbnailRenderer = new ProjectRenderer(renderer.module);
  try {
    for (const entry of entries) {
      if (!homeVisible || generation !== homeGeneration) return;
      const row = node("article"); row.className = "project-card"; row.dataset.projectId = entry.id;
      const open = button("", async () => {
        await flush();
        if (!hasProject || entry.id !== project().id) replace(await persistence.openProject(entry.id));
        persistence.save(project()); enterEditor();
      }, fail);
      open.className = "project-open"; open.setAttribute("aria-label", `打开项目 ${entry.name}`);
      const previewBox = node("div"); previewBox.className = "project-preview";
      const info = node("div"); info.className = "project-info";
      info.append(node("strong", entry.name), node("small", "正在生成默认页预览…"));
      open.append(previewBox, info); row.append(open);
      const actions = node("div"); actions.className = "project-actions";
      actions.append(button("重命名", () => {
        renameId = entry.id; element<HTMLInputElement>("#rename-name").value = entry.name;
        element<HTMLDialogElement>("#rename-dialog").showModal(); element<HTMLInputElement>("#rename-name").select();
      }, fail), button("复制项目", async () => {
        await flush();
        const original = entry.id === project().id && hasProject ? snapshot(project()) : await persistence.readProject(entry.id);
        await persistence.detach(); original.id = id(); original.name += " 副本";
        original.createdAt = original.modifiedAt = new Date().toISOString();
        replace(original); persistence.save(project()); enterEditor();
      }, fail), button("删除缓存条目", async () => {
        if (!confirm("删除这个浏览器缓存项目？不会删除磁盘文件，请确保已有备份。")) return;
        await flush(); await persistence.deleteProject(entry.id);
        if (hasProject && entry.id === project().id) { await persistence.detach(); replace(createProject()); hasProject = false; }
        await renderHome();
      }, fail));
      row.append(actions); list.append(row);
      try {
        const model = hasProject && entry.id === project().id ? snapshot(project()) : await persistence.readProject(entry.id);
        if (!homeVisible || generation !== homeGeneration) return;
        const defaultPage = model.pages.find(value => value.id === model.defaultPageId)!;
        const [width, height] = logicalSize(model), result = thumbnailRenderer.render(model, defaultPage, model.display.bufferMode === "page");
        const thumbnail = node("canvas"); showPixels(thumbnail, result.pixels, width, height);
        thumbnail.style.width = `${width * Math.min(240 / width, 142 / height)}px`;
        thumbnail.style.height = `${height * Math.min(240 / width, 142 / height)}px`;
        thumbnail.setAttribute("aria-label", `${entry.name} 默认页 ${defaultPage.name} 预览`);
        previewBox.append(thumbnail);
        info.lastElementChild!.textContent = `${width} × ${height} · ${model.pages.length} 页 · ${defaultPage.name}`;
        info.append(node("small", `更新于 ${new Date(model.modifiedAt).toLocaleString()}`));
        if (result.errors.length) { const error = node("p", result.errors.join("\n")); error.className = "project-error"; row.append(error); }
      } catch (error) {
        const message = node("p", `预览失败：${error instanceof Error ? error.message : String(error)}`);
        message.className = "project-error"; row.append(message); info.lastElementChild!.textContent = "项目不可预览，请检查项目包";
      }
    }
  } finally { thumbnailRenderer.dispose(); }
}
for (const proxy of document.querySelectorAll<HTMLButtonElement>("[data-action]"))
  proxy.addEventListener("click", () => element<HTMLButtonElement>(`#${proxy.dataset.action}`).click());
action("#project-settings", () => { projectProperties(); element<HTMLDialogElement>("#settings-dialog").showModal(); });
action("#close-settings", () => element<HTMLDialogElement>("#settings-dialog").close());
action("#close-rename", () => element<HTMLDialogElement>("#rename-dialog").close());
element<HTMLFormElement>("#rename-form").addEventListener("submit", event => {
  event.preventDefault();
  void (async () => {
    const name = element<HTMLInputElement>("#rename-name").value.trim();
    if (!name) throw new Error("项目名称不能为空");
    const targetId = renameId;
    if (!targetId) throw new Error("未选择要重命名的项目");
    await flush();
    if (!hasProject || targetId !== project().id) replace(await persistence.openProject(targetId));
    hasProject = true;
    commit(current => { const parsed = parseProject({ ...current, name }, current.resources); Object.assign(current, parsed); });
    await flush(); element<HTMLDialogElement>("#rename-dialog").close(); await renderHome();
  })().catch(fail);
});
action("#new-project", async () => {
  await flush(); await persistence.detach(); replace(createProject()); enterEditor(); scheduleSave();
});
action("#open-directory", async () => {
  if (!confirm("打开目录中的项目（若为空则保存当前项目）。当前项目请先备份。")) return;
  const [loaded] = await Promise.all([persistence.chooseDirectory(), flush()]);
  if (loaded) replace(loaded); persistence.save(project()); enterEditor();
});
action("#authorize", async () => { await persistence.authorize(); persistence.save(project()); });
action("#save-now", async () => { persistence.save(project()); await flush(); });
async function packageOperation<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  packageJob?.abort(); const job = new AbortController(); packageJob = job; element("#cancel-io").hidden = false;
  try { return await action(job.signal); }
  finally { if (packageJob === job) { packageJob = undefined; element("#cancel-io").hidden = true; } }
}
action("#cancel-io", () => packageJob?.abort());
action("#save-package", async () => {
  notify("正在本地打包完整资源…");
  const packed = await packageOperation(signal => packProject(snapshot(project()), signal));
  download("project.oled.zip", packed);
  try { await flush(); notify("完整项目包已下载，包含原图和源字体"); }
  catch (error) { notify(`完整项目包已下载；缓存保存失败：${error instanceof Error ? error.message : String(error)}`, true); }
});
action("#import-package", () => element<HTMLInputElement>("#package-file").click());
element<HTMLInputElement>("#package-file").addEventListener("change", event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return;
  void (async () => {
    if (file.size > 128 * 1024 * 1024) throw new Error("项目包超过 128 MiB");
    notify("正在校验完整项目包，可取消…");
    const currentId = project().id;
    const loaded = await packageOperation(async signal => unpackProject(new Uint8Array(await file.arrayBuffer()), signal));
    if (project().id !== currentId) throw new Error("项目已切换，未应用过期导入结果");
    const count = loaded.pages.reduce((sum, page) => sum + page.components.length, 0);
    const currentCount = project().pages.reduce((sum, page) => sum + page.components.length, 0);
    const currentTime = Date.parse(project().modifiedAt), loadedTime = Date.parse(loaded.modifiedAt);
    const older = loaded.id === project().id && Number.isFinite(currentTime) && Number.isFinite(loadedTime) && loadedTime < currentTime;
    if (!confirm(`导入文件：${file.name}\n包内 ${loaded.pages.length} 个页面、${count} 个组件；当前项目 ${currentCount} 个组件。\n${older ? "注意：该包比当前项目更旧。\n" : ""}导入会替换当前设计，不会合并新增组件。请选择最新下载的包，并确认当前数据已备份。`)) return;
    const sameProject = loaded.id === project().id;
    const currentVersion = project().modifiedAt;
    await flush();
    if (project().id !== currentId || project().modifiedAt !== currentVersion) throw new Error("项目已修改或切换，未应用过期导入结果");
    if (!sameProject) await persistence.detach();
    replace(loaded); persistence.save(project()); enterEditor();
    const saveHint = persistence.hasDirectory ? "同项目保留原目录绑定；写盘结果请查看保存状态，必要时重新授权。" : "当前未绑定目录；请选择空目录保存，选择已有项目目录会打开其中的快照。";
    notify(`已导入 ${loaded.pages.length} 页、${count} 个组件；当前打开默认页“${page().name}”。${saveHint}`);
  })().catch(fail).finally(() => { input.value = ""; });
});
const openResources = resourceManager(project, commit, notify, () => renderer); action("#resources", () => openResources());
function imagesPanel(): void {
  const resources = project().resources.filter(value => value.kind === "image"), list = element("#sidebar-images");
  const query = element<HTMLInputElement>("#sidebar-image-search").value.toLowerCase();
  element("#sidebar-image-count").textContent = String(resources.length); list.replaceChildren();
  for (const resource of resources.filter(value => value.name.toLowerCase().includes(query))) {
    const card = node("div"); card.className = "sidebar-image";
    const add = button("", () => {
      const component = createComponent("image"); if (component.type !== "image") throw new Error("图片组件创建失败"); component.resourceId = resource.id;
      component.name = nextComponentName(page().components, "image");
      selection = new Set([component.id]); commit(() => page().components.push(component));
    }, fail);
    add.setAttribute("aria-label", `添加图片 ${resource.name}`);
    const thumb = node("canvas"); showPixels(thumb, unpackXbm(resource.width, resource.height, resource.data), resource.width, resource.height);
    thumb.style.width = `${Math.min(140 / resource.width, 80 / resource.height) * resource.width}px`;
    thumb.style.height = `${Math.min(140 / resource.width, 80 / resource.height) * resource.height}px`;
    add.append(thumb, node("span", resource.name)); card.append(add, node("small", `${resource.width} × ${resource.height} · ${resource.data.length} B`),
      button("编辑资源", () => openResources(resource.id), fail)); list.append(card);
  }
  if (!list.childElementCount) list.append(node("p", resources.length ? "没有匹配图片。" : "暂无图片，点击添加图片可导入或手工绘制。"));
}
function sidebarTab(images: boolean): void {
  element("#layout-panel").hidden = images; element("#images-panel").hidden = !images;
  element("#layout-tab").setAttribute("aria-pressed", String(!images)); element("#images-tab").setAttribute("aria-pressed", String(images));
  if (images) imagesPanel();
}
action("#layout-tab", () => sidebarTab(false)); action("#images-tab", () => sidebarTab(true));
action("#sidebar-add-image", () => openResources(undefined, true));
element("#sidebar-image-search").addEventListener("input", imagesPanel);
action("#project-library", showHome);
action("#export-png", () => {
  preview(); if (diagnostics.length) throw new Error("请先解决预览诊断");
  const output = node("canvas");
  showPixels(output, lastPixels, canvas.width, canvas.height);
  output.toBlob(blob => { if (!blob) { fail(new Error("PNG 导出失败")); return; }
    void blob.arrayBuffer().then(bytes => download("page.png", new Uint8Array(bytes), "image/png")).catch(fail); }, "image/png");
});
const exportTarget = element<HTMLSelectElement>("#export-target");
for (const target of exportTargets) exportTarget.add(new Option(target.label, target.value));
function exportDescription(): void {
  element("#export-description").textContent = exportTargets.find(target => target.value === exportTarget.value)?.description ?? "请选择支持的平台";
}
exportTarget.addEventListener("change", exportDescription);
action("#export-code", () => { exportDescription(); element<HTMLDialogElement>("#export-dialog").showModal(); });
action("#close-export", () => element<HTMLDialogElement>("#export-dialog").close());
action("#confirm-export", () => {
  const target = parseExportTarget(exportTarget.value);
  download(`oled-ui-${target}.zip`, exportProject(project(), renderer, target));
  element<HTMLDialogElement>("#export-dialog").close(); notify(`已导出 ${exportTargets.find(value => value.value === target)!.label} UI 代码包；不包含设备驱动`);
});
window.addEventListener("beforeunload", event => { if (saveTimer || persistence.state.busy) { event.preventDefault(); } });
declare global { interface Window {
  oledStudio: { ready: boolean; project(): Project; load(project: Project): void; preview(paged?: boolean): number[]; flush(): Promise<void> };
} }
window.oledStudio = { ready: false, project: () => snapshot(project()), load: value => { replace(parseProject(value, value.resources)); enterEditor(); },
  preview: paged => Array.from(renderer.render(project(), page(), paged).pixels), flush };
Promise.all([OledRenderer(), persistence.recover().then(value => ({ value, error: undefined }),
  (error: unknown) => ({ value: undefined, error }))]).then(([module, recovery]) => {
  renderer = new ProjectRenderer(module); ready = true; window.oledStudio.ready = true;
  if (recovery.value) { replace(recovery.value); hasProject = true; } else update();
  if (recovery.error) fail(recovery.error);
  else notify("离线工作空间已就绪。选择项目卡片，或新建项目开始设计。");
  return renderHome();
}).catch(fail);
