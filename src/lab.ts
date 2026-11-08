import { allocate, assertGlyphs, pixels, withText } from "./runtime";
import type { RendererModule } from "./runtime";
import type { FontRequest, FontResult } from "./font-worker";
import { drawFixture } from "./fixture";
import { filterLocalFonts, listLocalFonts, readLocalFont } from "./local-fonts";
import type { LocalFont } from "./local-fonts";
import { validateThreshold } from "./font-threshold";

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`页面缺少元素 ${selector}`);
  return result;
}

const status = element("#status");
const canvas = element<HTMLCanvasElement>("#preview");
const output = element("#output");
const convertButton = element<HTMLButtonElement>("#convert");
const cancelButton = element<HTMLButtonElement>("#cancel");
const context = canvas.getContext("2d");
if (!context) throw new Error("浏览器不支持 Canvas 2D");
let renderer: RendererModule;
let font: FontResult | undefined;
let worker: Worker | undefined;
let conversionGeneration = 0;
let sourceFile: File | undefined;
let lastPixels = new Uint8Array(128 * 64);
let localFonts: LocalFont[] = [];
let listingFonts = false;
const fontSource = element<HTMLSelectElement>("#font-source");
const pcFontSelect = element<HTMLSelectElement>("#pc-font");
const pcFontSearch = element<HTMLInputElement>("#pc-font-search");
const loadFontsButton = element<HTMLButtonElement>("#load-pc-fonts");
const thresholdInput = element<HTMLInputElement>("#threshold");
const thresholdRange = element<HTMLInputElement>("#threshold-range");
const settingsState = element("#font-settings-state");

function notify(message: string, error = false): void {
  status.textContent = message;
  status.dataset["state"] = error ? "error" : "ready";
}

function show(data: Uint8Array, width = 128, height = 64): void {
  canvas.width = width; canvas.height = height;
  const image = new ImageData(width, height);
  for (let index = 0; index < data.length; index++) {
    const value = data[index] ? 235 : 15;
    image.data[index * 4] = value;
    image.data[index * 4 + 1] = data[index] ? 255 : 24;
    image.data[index * 4 + 2] = data[index] ? 246 : 30;
    image.data[index * 4 + 3] = 255;
  }
  context!.putImageData(image, 0, 0);
  lastPixels = data.slice();
}

function fixture(paged: boolean): Uint8Array {
  if (!renderer._render_init(128, 64, paged ? 1 : 0)) throw new Error("U8g2 缓冲初始化失败");
  for (let row = 0; row < (paged ? 8 : 1); row++) {
    renderer._render_page(row);
    drawFixture(renderer);
    pixels(renderer, 128, 64);
  }
  return pixels(renderer, 128, 64);
}

function renderFont(): void {
  if (!font) throw new Error("请先生成中文字库");
  const text = element<HTMLTextAreaElement>("#text").value;
  if (!renderer._render_init(128, 64, 0)) throw new Error("U8g2 初始化失败");
  const pointer = allocate(renderer, font.bytes);
  try {
    renderer._render_font(0, pointer);
    assertGlyphs(renderer, text);
    renderer._render_color(1);
    let baseline = renderer._render_ascent() + 2;
    const height = renderer._render_ascent() - renderer._render_descent() + 2;
    for (const line of text.split("\n")) {
      withText(renderer, line, value => renderer._render_text(2, baseline, value, 1));
      baseline += height;
    }
    show(pixels(renderer, 128, 64));
    output.textContent = `${font.coverage.length} 字符 · ${font.bytes.length} 字节 · 字库基线度量 ${renderer._render_ascent()}/${renderer._render_descent()}\n来源：${font.parameters.sourceName} · ${font.parameters.size} px · 阈值 ${font.parameters.threshold}/255\n预览来源：生成后的 U8g2 压缩字库（不是系统字体）`;
    if (font.requiresLargeFonts) {
      output.textContent += "\n大字库：32 位目标需启用 U8G2_USE_LARGE_FONTS；AVR 请缩小字符子集。默认编译将明确报错，不静默省略字库。";
    }
    notify("中文字库生成并经 U8g2 解码预览");
  } finally { renderer._free(pointer); }
}

function download(name: string, data: BlobPart, type = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function action(selector: string, callback: () => void): void {
  element(selector).addEventListener("click", () => {
    try { callback(); }
    catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
  });
}

action("#fixture", () => {
  show(fixture(false));
  output.textContent = "128×64 原生测试场景 · 三种 ASCII 字体 · 13×3 XBM · 凹多边形";
  notify("U8g2 原生绘制场景已加载");
});
action("#compare", () => {
  const full = fixture(false), paged = fixture(true);
  let differences = 0;
  for (let index = 0; index < full.length; index++) if (full[index] !== paged[index]) differences++;
  show(paged);
  output.textContent = `全缓冲与单页缓冲对照：${differences} 个差异像素`;
  notify(differences === 0 ? "页缓冲一致性通过" : "页缓冲结果不一致", differences !== 0);
});
action("#preview-font", renderFont);
action("#download-c", () => {
  if (!font) throw new Error("请先生成字库");
  download("oled_custom_font.c", font.c);
});
action("#download-bdf", () => {
  if (!font) throw new Error("请先生成字库");
  download("oled_custom_font.bdf", font.bdf);
});
action("#download-raw", () => download("preview.raw", lastPixels.slice().buffer, "application/octet-stream"));

function stopWorker(): void {
  worker?.terminate(); worker = undefined;
  convertButton.disabled = false; cancelButton.disabled = true;
}

function settingsChanged(): void {
  settingsState.textContent = font ? "参数已修改；当前预览和下载仍是上次生成的字库，请重新生成。" : "当前参数尚未生成字库。";
}

function populateLocalFonts(): void {
  const previous = pcFontSelect.value;
  const filtered = filterLocalFonts(localFonts, pcFontSearch.value);
  pcFontSelect.replaceChildren(new Option(filtered.length ? "请选择字体" : "没有匹配的字体", ""));
  for (const font of filtered) {
    pcFontSelect.add(new Option(`${font.fullName} · ${font.style}`, font.postscriptName));
  }
  if (filtered.some(font => font.postscriptName === previous)) pcFontSelect.value = previous;
  pcFontSelect.disabled = filtered.length === 0;
  element("#pc-font-info").textContent = `已授权读取 ${localFonts.length} 个字体，当前匹配 ${filtered.length} 个；需拥有使用和分发权限。`;
  if (pcFontSelect.value !== previous) settingsChanged();
}

fontSource.addEventListener("change", () => {
  element("#custom-font-panel").hidden = fontSource.value !== "custom";
  element("#pc-font-panel").hidden = fontSource.value !== "pc";
  settingsChanged();
});
pcFontSearch.addEventListener("input", populateLocalFonts);
pcFontSelect.addEventListener("change", settingsChanged);
loadFontsButton.addEventListener("click", () => {
  listingFonts = true; loadFontsButton.disabled = true;
  void listLocalFonts().then(fonts => {
    localFonts = fonts;
    pcFontSearch.disabled = false;
    populateLocalFonts();
    notify("电脑字体列表已读取，请选择字体后生成");
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    element("#pc-font-info").textContent = message;
    notify(message, true);
  }).finally(() => { listingFonts = false; loadFontsButton.disabled = !window.oledLab.ready; });
});
thresholdRange.addEventListener("input", () => {
  thresholdInput.value = thresholdRange.value;
  settingsChanged();
});
thresholdInput.addEventListener("input", () => {
  const value = thresholdInput.valueAsNumber;
  if (Number.isInteger(value) && value >= 0 && value <= 255) thresholdRange.value = String(value);
  settingsChanged();
});
element("#font-size").addEventListener("input", settingsChanged);
element("#text").addEventListener("input", settingsChanged);

element<HTMLInputElement>("#font-file").addEventListener("change", event => {
  sourceFile = (event.target as HTMLInputElement).files?.[0];
  element("#font-name").textContent = sourceFile ? sourceFile.name : "未选择字体";
  settingsChanged();
});

convertButton.addEventListener("click", () => {
  const generation = ++conversionGeneration;
  void (async () => {
    const sourceKind = fontSource.value;
    const selectedLocal = localFonts.find(value => value.postscriptName === pcFontSelect.value);
    const file = sourceFile;
    let sourceName: string;
    let readSource: () => Promise<ArrayBuffer>;
    if (sourceKind === "pc") {
      if (!selectedLocal) throw new Error("请先授权读取并选择电脑字体");
      sourceName = selectedLocal.fullName;
      readSource = () => readLocalFont(selectedLocal);
    } else if (sourceKind === "custom") {
      if (!file) throw new Error("请选择有使用授权的静态 TTF/OTF 文件");
      if (file.size > 32 * 1024 * 1024) throw new Error("源字体超过 32 MiB 验证版限制");
      sourceName = file.name;
      readSource = () => file.arrayBuffer();
    } else {
      throw new Error("不支持的字体来源");
    }
    const threshold = thresholdInput.valueAsNumber;
    validateThreshold(threshold);
    stopWorker();
    convertButton.disabled = true; cancelButton.disabled = false;
    notify("正在读取本地字体，不上传文件…");
    const text = element<HTMLTextAreaElement>("#text").value;
    const size = Number(element<HTMLInputElement>("#font-size").value);
    const source = await readSource();
    if (generation !== conversionGeneration) return;
    const request: FontRequest = {
      source, text, size, threshold, sourceName,
      sourcePostscriptName: sourceKind === "pc" && selectedLocal ? selectedLocal.postscriptName : "",
      symbol: "oled_custom_font",
    };
    const blobUrl = URL.createObjectURL(new Blob([OLED_WORKER_SOURCE], { type: "text/javascript" }));
    try { worker = new Worker(blobUrl); }
    finally { URL.revokeObjectURL(blobUrl); }
    convertButton.disabled = true; cancelButton.disabled = false;
    notify("正在本地栅格化并转换，不上传文件…");
    worker.onmessage = (event: MessageEvent<FontResult | { type: "progress"; done: number; total: number } | { type: "error"; message: string }>) => {
      if (generation !== conversionGeneration) return;
      const message = event.data;
      if (message.type === "progress") { notify(`转换字形 ${message.done}/${message.total}`); return; }
      stopWorker();
      if (message.type === "error") { notify(message.message, true); return; }
      font = message;
      settingsState.textContent = `已生成：${font.parameters.sourceName} · ${font.parameters.size} px · 阈值 ${font.parameters.threshold}/255。`;
      if (thresholdInput.valueAsNumber !== threshold || Number(element<HTMLInputElement>("#font-size").value) !== size ||
          element<HTMLTextAreaElement>("#text").value !== text || fontSource.value !== sourceKind ||
          (sourceKind === "custom" ? sourceFile !== file : pcFontSelect.value !== selectedLocal?.postscriptName)) settingsChanged();
      try { renderFont(); }
      catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
    };
    worker.onerror = event => {
      if (generation !== conversionGeneration) return;
      stopWorker(); notify(`字体转换 Worker 失败：${event.message}`, true);
    };
    worker.postMessage(request, [source]);
  })().catch((error: unknown) => {
    if (generation !== conversionGeneration) return;
    stopWorker(); notify(error instanceof Error ? error.message : String(error), true);
  });
});
cancelButton.addEventListener("click", () => { conversionGeneration++; stopWorker(); notify("已取消字库转换，原字库保留"); });

// This bounded test bridge exposes real runtime output, not test-specific rendering.
declare global {
  interface Window {
    oledLab: {
      ready: boolean;
      fixture(paged: boolean): number[];
      fontResult(): FontResult | undefined;
      preview(): number[];
      renderer(): RendererModule;
    };
  }
}
window.oledLab = {
  ready: false, fixture: paged => Array.from(fixture(paged)), fontResult: () => font,
  preview: () => Array.from(lastPixels), renderer: () => renderer,
};
OledRenderer().then(module => {
  renderer = module;
  show(fixture(false));
  window.oledLab.ready = true;
  document.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
    if (button !== cancelButton && !(button === loadFontsButton && listingFonts)) button.disabled = false;
  });
  notify("离线 U8g2 2.36.5 运行时就绪");
}).catch((error: unknown) => notify(`U8g2 初始化失败：${error instanceof Error ? error.message : String(error)}`, true));
