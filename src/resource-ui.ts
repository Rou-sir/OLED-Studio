import { element, node, button, field, download, showPixels } from "./ui";
import { id, resourceReferences, validateResource, validateResourceBudget, builtinFonts } from "./project";
import type { Project, Resource, ImageOptions } from "./project";
import { unpackXbm, bitmapBounds, cropBitmap } from "./bitmap";
import { readImage, convertImage, parseBitmapC, importBitmap } from "./image-tool";
import { FontTool } from "./font-tool";
import { listLocalFonts, readLocalFont, filterLocalFonts } from "./local-fonts";
import type { LocalFont } from "./local-fonts";
import { parseFontC } from "./c-data";
import { inspectFont } from "./font-validation";
import type { FontResult } from "./font-worker";
import type { ProjectRenderer } from "./project-renderer";
import { allocate, withText, pixels } from "./runtime";
import { resourceNames, fontSymbol, fontResourceNames, fontC } from "./export";

export function resourceManager(getProject: () => Project, commit: (action: (project: Project) => void) => void,
  notify: (message: string, error?: boolean) => void, getRenderer: () => ProjectRenderer): (resourceId?: string, createImage?: boolean) => void {
  const fail = (error: unknown) => notify(error instanceof Error ? error.message : String(error), true);
  const dialog = element<HTMLDialogElement>("#resource-dialog"), editor = element("#resource-editor"), list = element("#resource-list");
  const tool = new FontTool();
  let selected = "", generation = 0, disposeImage: (() => void) | undefined;
  let category: Resource["kind"] = "image";
  const searches = { image: "", font: "" };
  function categoryView(kind: Resource["kind"]): void {
    searches[category] = element<HTMLInputElement>("#resource-search").value;
    category = kind;
    const search = element<HTMLInputElement>("#resource-search");
    search.value = searches[kind]; search.placeholder = kind === "image" ? "搜索图片名称" : "搜索字库名称";
    element("#resource-images-tab").setAttribute("aria-pressed", String(kind === "image"));
    element("#resource-fonts-tab").setAttribute("aria-pressed", String(kind === "font"));
    element("#new-image").hidden = kind !== "image";
    element("#new-font").hidden = kind !== "font";
  }
  function fontPreview(parent: HTMLElement, builtin: number, data?: Uint8Array, text = "OLED 123 gyp"): void {
    const m = getRenderer().module, pointer = data ? allocate(m, data) : 0;
    try {
      if (!m._render_init(180, 64, 0)) throw new Error("字库预览画布初始化失败");
      m._render_font(builtin, pointer); m._render_color(1);
      withText(m, text, t => m._render_text(2, Math.max(1, m._render_ascent()) + 2, t, 1));
      const canvas = node("canvas"); showPixels(canvas, pixels(m, 180, 64), 180, 64); parent.append(canvas);
      parent.append(node("small", `原生 ascent ${m._render_ascent()} / descent ${m._render_descent()} · U8g2 字库像素，不是系统字体替代`));
    } finally { if (pointer) m._free(pointer); }
  }
  function reset(): void { generation++; tool.cancel(); disposeImage?.(); disposeImage = undefined; editor.replaceChildren(); }
  function refresh(): void {
    list.replaceChildren();
    const project = getProject(), query = element<HTMLInputElement>("#resource-search").value.toLowerCase();
    element("#resource-image-count").textContent = String(project.resources.filter(resource => resource.kind === "image").length);
    element("#resource-font-count").textContent = String(project.resources.filter(resource => resource.kind === "font").length + builtinFonts.length);
    for (let index = 0; category === "font" && index < builtinFonts.length; index++) {
      const font = builtinFonts[index]!;
      if (query && !`${font.name} ${font.symbol} 等宽 ASCII`.toLowerCase().includes(query)) continue;
      const card = node("div"); card.className = "resource-card";
      card.append(node("strong", font.symbol), node("small", `内置 · ${font.name} · 等宽 · 可打印 ASCII · U8g2 2.36.5`));
      fontPreview(card, index); list.append(card);
    }
    for (const resource of project.resources.filter(resource => resource.kind === category && resource.name.toLowerCase().includes(query))) {
      const card = node("div"); card.className = `resource-card${resource.id === selected ? " selected" : ""}`;
      card.append(button(`${resource.kind === "image" ? "图片" : "字库"} · ${resource.name}`, () => edit(resource), fail));
      if (resource.kind === "image") {
        const canvas = node("canvas"); showPixels(canvas, unpackXbm(resource.width, resource.height, resource.data), resource.width, resource.height);
        canvas.style.width = `${Math.min(resource.width * 3, 220)}px`; card.append(canvas);
      } else {
        fontPreview(card, 0, resource.data, resource.coverage.slice(0, 8).map(code => String.fromCodePoint(code)).join(""));
        card.append(node("small", `${resource.coverage.length} 字符 · ${resource.size ?? "导入"} px · 阈值 ${resource.threshold ?? "未知"}`));
      }
      card.append(node("small", `${resource.data.length} B · ${resource.kind === "image" ? `${resource.width}×${resource.height} · ` : ""}${resourceReferences(project, resource.id).length} 处引用`));
      list.append(card);
    }
    if (!list.children.length) {
      const empty = node("p", query ? "当前分类没有匹配的资源" : category === "image" ? "暂无图片，点击“添加图片”导入或绘制。" : "暂无字库");
      empty.className = "resource-empty"; list.append(empty);
    }
    const references = editor.querySelector<HTMLElement>(".resource-references");
    if (references) referenceList(references, selected);
  }
  function referenceList(parent: HTMLElement, resourceId: string): void {
    const refs = resourceReferences(getProject(), resourceId);
    parent.replaceChildren();
    const heading = node("div"); heading.className = "panel-heading";
    heading.append(node("h2", "引用位置"), node("span", `${refs.length} 处引用`)); parent.append(heading);
    if (!refs.length) { parent.append(node("p", "暂无组件引用此资源")); return; }
    const items = node("ul"); items.className = "resource-reference-list"; items.setAttribute("aria-label", "资源引用位置");
    for (const ref of refs) {
      const item = node("li");
      item.append(node("strong", ref.page.name), node("span", ref.component.name));
      items.append(item);
    }
    parent.append(items);
  }
  function apply(resource: Resource, projectId: string): boolean {
    if (getProject().id !== projectId) throw new Error("项目已切换，未加入过期转换结果");
    validateResource(resource);
    validateResourceBudget([...getProject().resources.filter(value => value.id !== resource.id), resource]);
    const refs = resourceReferences(getProject(), resource.id);
    if (refs.length && !confirm(`替换该资源会影响：${refs.map(ref => ref.page.name + "/" + ref.component.name).join("、")}。尺寸或字形改变后请检查布局。确认应用？`)) return false;
    commit(project => {
      const index = project.resources.findIndex(value => value.id === resource.id);
      if (index < 0) project.resources.push(resource); else project.resources[index] = resource;
    });
    selected = resource.id; refresh(); notify("资源已加入项目，可在组件属性中绑定");
    return true;
  }
  function metadata(existing?: Resource): { resourceId: string; name: HTMLInputElement; license: HTMLTextAreaElement; projectId: string } {
    reset(); selected = existing?.id ?? ""; refresh();
    if (existing) {
      const references = node("section"); references.className = "resource-references";
      referenceList(references, existing.id); editor.append(references);
    }
    const name = field(editor, "资源名称", existing?.name ?? "新资源", () => {}, fail) as HTMLInputElement;
    const license = field(editor, "来源 / 许可声明", existing?.license ?? "", () => {}, fail, undefined, true) as HTMLTextAreaElement;
    editor.append(node("p", "源文件仅本地保存；安装字体或读取文件不代表拥有分发许可。"));
    return { resourceId: existing?.id ?? id(), name, license, projectId: getProject().id };
  }
  function resourceActions(resource: Resource): void {
    const actions = node("div"); actions.className = "buttons"; editor.append(actions);
    actions.append(button("下载取模 / 字库数据", () => download(`${resource.kind}.bin`, resource.data), fail),
      button("复制资源", () => {
        const copy = { ...resource, id: id(), name: resource.name + " 副本" };
        validateResourceBudget([...getProject().resources, copy]); commit(project => project.resources.push(copy)); refresh();
      }, fail),
      button("删除资源", () => {
        const refs = resourceReferences(getProject(), resource.id);
        if (refs.length) throw new Error(`资源仍被 ${refs.map(ref => ref.page.name + "/" + ref.component.name).join("、")} 引用，请先解除或更换绑定`);
        if (!confirm("删除此资源？")) return;
        commit(project => { project.resources = project.resources.filter(value => value.id !== resource.id); }); reset(); selected = ""; refresh();
      }, fail));
    if (resource.kind === "image") actions.append(button("下载 XBM / C 数组", () => {
      const name = resourceNames(getProject().resources).get(resource.id)!;
      const text = `#define ${name}_width ${resource.width}\n#define ${name}_height ${resource.height}\nstatic const unsigned char ${name}_bits[] = {\n` +
        Array.from(resource.data, byte => "0x" + byte.toString(16).padStart(2, "0")).join(", ") + "\n};\n";
      download(`${name}.xbm`, text, "text/plain");
    }, fail));
  }
  function edit(resource: Resource): void {
    if (resource.kind === "image") imageEditor(resource); else fontEditor(resource);
    resourceActions(resource);
  }
  function imageEditor(existing?: Extract<Resource, { kind: "image" }>): void {
    categoryView("image");
    const meta = metadata(existing), token = generation;
    const mode = node("div"); mode.className = "buttons image-mode";
    mode.append(button("导入 / 取模模式", () => {}, fail), button("手工绘制模式", () => {
      if (confirm("切换到绘制模式？未保存的取模参数将丢弃，项目资源不会改变。")) drawingEditor(existing);
    }, fail)); editor.append(mode);
    let source = existing?.source, sourceType = existing?.sourceType ?? "", sourceName = existing?.sourceName ?? "", image: ImageBitmap | undefined, reading = 0;
    let converted: Uint8Array | undefined = existing?.data, conversionVersion = 0, convertedVersion = existing ? 0 : -1;
    const options: ImageOptions = existing?.options ? { ...existing.options } :
      { x: 0, y: 0, cropWidth: 1, cropHeight: 1, width: existing?.width ?? 32, height: existing?.height ?? 32,
        threshold: 128, invert: false, background: 0, dither: false };
    editor.append(node("h2", "原图取模：PNG / JPEG / BMP"));
    const file = node("input"); file.type = "file"; file.accept = ".png,.jpg,.jpeg,.bmp"; editor.append(file);
    let frame: number | undefined, previewZoom = 6;
    const controls = node("div"), preview = node("canvas"), previewPanel = node("section"), previewViewport = node("div"), previewStatus = node("p");
    previewPanel.className = "image-preview-panel"; previewViewport.className = "image-preview-viewport";
    preview.id = "image-conversion-preview"; previewStatus.className = "subtitle"; previewStatus.setAttribute("role", "status");
    preview.hidden = !converted;
    disposeImage = () => { image?.close(); if (frame !== undefined) cancelAnimationFrame(frame); };
    function scalePreview(): void {
      preview.style.width = `${preview.width * previewZoom}px`; preview.style.height = `${preview.height * previewZoom}px`;
    }
    function invalidate(): void {
      conversionVersion++; converted = undefined; convertedVersion = -1; preview.hidden = true;
      if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
    }
    function conversionError(error: unknown): void {
      invalidate(); previewStatus.textContent = error instanceof Error ? error.message : String(error); fail(error);
    }
    function renderImage(): void {
      if (!image) throw new Error("请先加载原图；仅有取模数据的资源不能重新取模");
      converted = convertImage(image, options); convertedVersion = conversionVersion;
      showPixels(preview, unpackXbm(options.width, options.height, converted), options.width, options.height);
      scalePreview(); preview.hidden = false;
      previewStatus.textContent = `${options.width} × ${options.height} · ${converted.length} B · 逐行 LSB-first XBM；保存资源后才应用到项目`;
    }
    function controlsChanged(): void {
      invalidate(); previewStatus.textContent = "正在刷新预览…";
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (token !== generation) return;
        try { renderImage(); } catch (error) { conversionError(error); }
      });
    }
    function properties(): void {
      controls.replaceChildren();
      for (const key of ["x", "y", "cropWidth", "cropHeight", "width", "height", "threshold"] as const) {
        const labels = { x: "裁剪 X", y: "裁剪 Y", cropWidth: "裁剪宽", cropHeight: "裁剪高", width: "输出宽", height: "输出高", threshold: "亮度阈值 0–255" };
        field(controls, labels[key], options[key], value => { options[key] = Number(value); controlsChanged(); }, conversionError, undefined, false, "input");
      }
      field(controls, "透明背景白色", !!options.background, value => { options.background = value ? 1 : 0; controlsChanged(); }, conversionError, undefined, false, "input");
      field(controls, "反色", options.invert, value => { options.invert = !!value; controlsChanged(); }, conversionError, undefined, false, "input");
      field(controls, "Floyd–Steinberg 抖动", options.dither, value => { options.dither = !!value; controlsChanged(); }, conversionError, undefined, false, "input");
    }
    async function load(bytes: Uint8Array, type: string, defaults: boolean, job: number): Promise<boolean> {
      const loaded = await readImage(bytes, type);
      if (token !== generation || job !== reading) { loaded.close(); return false; }
      image?.close(); image = loaded;
      if (defaults) { options.x = 0; options.y = 0; options.cropWidth = image.width; options.cropHeight = image.height; properties(); }
      notify(`原图 ${image.width} × ${image.height}，修改参数将实时刷新预览`);
      return true;
    }
    file.addEventListener("change", () => {
      const selectedFile = file.files?.[0]; if (!selectedFile) return;
      const job = ++reading;
      invalidate(); image?.close(); image = undefined; source = undefined;
      previewStatus.textContent = "正在读取原图…";
      void (async () => {
        if (selectedFile.size > 32 * 1024 * 1024) throw new Error("原图超过 32 MiB");
        const bytes = new Uint8Array(await selectedFile.arrayBuffer());
        const type = selectedFile.type || (selectedFile.name.toLowerCase().endsWith(".bmp") ? "image/bmp" : "");
        if (token !== generation || job !== reading) return;
        if (await load(bytes, type, true, job)) {
          source = bytes; sourceType = type; sourceName = selectedFile.name; meta.name.value = selectedFile.name; controlsChanged();
        }
      })().catch(error => { if (token === generation && job === reading) conversionError(error); });
    });
    if (source) {
      const job = ++reading;
      void load(source, sourceType, false, job).then(loaded => { if (loaded) controlsChanged(); })
        .catch(error => { if (token === generation && job === reading) conversionError(error); });
    }
    properties(); editor.append(controls, previewPanel);
    previewPanel.append(node("h2", "实时取模预览"));
    const zoomControl = field(previewPanel, "预览缩放", previewZoom, value => {
      const next = Number(value);
      if (!Number.isInteger(next) || next < 1 || next > 32) throw new Error("预览缩放须为 1–32 整数");
      previewZoom = next; scalePreview();
    }, fail) as HTMLInputElement;
    zoomControl.min = "1"; zoomControl.max = "32"; zoomControl.step = "1";
    previewViewport.append(preview); previewPanel.append(previewViewport, previewStatus);
    if (converted) {
      showPixels(preview, unpackXbm(options.width, options.height, converted), options.width, options.height); scalePreview();
      previewStatus.textContent = "已保存的取模数据；修改参数后实时刷新。";
    } else previewStatus.textContent = "加载原图后显示预览。";
    editor.append(button("生成图片预览", () => {
      renderImage(); notify("图片取模完成（逐行 LSB-first XBM）");
    }, conversionError), button("保存图片资源", () => {
      if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; renderImage(); }
      if (!converted || convertedVersion !== conversionVersion) throw new Error("请先取模生成当前参数");
      const resource: Resource = { id: meta.resourceId, name: meta.name.value, license: meta.license.value,
        kind: "image", width: options.width, height: options.height, data: converted };
      if (source) { resource.source = source; resource.sourceType = sourceType; resource.sourceName = sourceName; resource.options = { ...options }; }
      apply(resource, meta.projectId);
    }, fail));
    const external = node("details"); external.append(node("summary", "导入外部 XBM / C / 二进制取模数据"));
    const rawFile = node("input"); rawFile.type = "file"; rawFile.accept = ".xbm,.h,.c,.bin,.raw"; external.append(rawFile);
    const width = field(external, "数据宽", options.width, () => {}, fail) as HTMLInputElement;
    const height = field(external, "数据高", options.height, () => {}, fail) as HTMLInputElement;
    const format = field(external, "排列", "lsb", () => {}, fail, [{ value: "lsb", label: "逐行 LSB-first / XBM" },
      { value: "msb", label: "逐行 MSB-first" }, { value: "page", label: "垂直页 / SSD1306" }]) as HTMLSelectElement;
    const invert = field(external, "取模极性反色", false, () => {}, fail) as HTMLInputElement;
    external.append(button("导入取模数据并保存", async () => {
      const f = rawFile.files?.[0]; if (!f || f.size > 1024 * 1024) throw new Error("请选择不超过 1 MiB 的取模数据文件");
      let bytes: Uint8Array = new Uint8Array(await f.arrayBuffer()), w = width.valueAsNumber, h = height.valueAsNumber;
      if (/\.(xbm|h|c)$/i.test(f.name)) {
        const parsed = parseBitmapC(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        bytes = parsed.bytes; w = parsed.width ?? w; h = parsed.height ?? h;
      }
      const fmat = format.value;
      if (fmat !== "lsb" && fmat !== "msb" && fmat !== "page") throw new Error("未知取模排列");
      if (token !== generation) return;
      apply({ id: meta.resourceId, name: meta.name.value, license: meta.license.value, kind: "image",
        width: w, height: h, data: importBitmap(bytes, w, h, fmat, invert.checked) }, meta.projectId);
    }, fail)); editor.append(external);
  }
  function fontEditor(existing?: Extract<Resource, { kind: "font" }>): void {
    categoryView("font");
    const meta = metadata(existing), token = generation;
    function section(title: string, hint: string): HTMLElement {
      const panel = node("section"); panel.className = "font-step";
      panel.append(node("h2", title), node("p", hint)); editor.append(panel); return panel;
    }
    const metadataPanel = section("资源信息", "名称也用于导出的 oled_font_ 符号，推荐英文、数字和下划线；中文转 Unicode 编码，重名追加序号。选择字体后可修改名称；请确认分发许可。");
    for (const child of [...editor.children]) if (child !== metadataPanel) metadataPanel.append(child);
    const sourcePanel = section("01 · 选择字体来源", "选择自定义静态 TTF/OTF，或授权读取电脑字体后选择具体样式。两种来源任选其一；下方显示实际使用的字体。");
    const charsPanel = section("02 · 配置字符集", "仅生成所需字符，重复字符会去重。可收集项目文字或导入 UTF-8 文本（≤128 KiB）；缺字会明确报错，不自动换字体。");
    const parameterPanel = section("03 · 调整生成参数", "像素尺寸是字形栅格化尺寸，不是预览倍率。阈值越低越容易保留细笔画，可先试 64–80；完全透明背景永不点亮。");
    const outputPanel = section("04 · 生成、检查与导出", "生成成功后加入项目；替换被引用的字库需确认影响。修改参数后必须重新生成，旧资源保持不变。");
    const outputStatus = node("p", existing ? "当前为已保存字库；可修改源字体参数重新生成。" : "尚未生成字库。");
    outputStatus.className = "font-result-status"; outputStatus.setAttribute("role", "status"); outputPanel.append(outputStatus);
    const outputPreview = node("div"); outputPreview.className = "font-output-preview"; outputPanel.append(outputPreview);
    if (existing) fontPreview(outputPreview, 0, existing.data, existing.coverage.slice(0, 12).map(code => String.fromCodePoint(code)).join(""));
    let source = existing?.source, postscriptName = existing?.postscriptName ?? "", fonts: LocalFont[] = [], result: FontResult | undefined, reading = 0;
    const parametersChanged = () => { result = undefined; outputStatus.textContent = "参数已修改，需重新生成；下方预览仍为上次成功字库。"; notify("参数已修改；资源预览和绑定仍是上次成功字库，请重新生成。"); };
    const fontFile = node("input"); fontFile.type = "file"; fontFile.accept = ".ttf,.otf";
    const fontFileLabel = node("label"); fontFileLabel.className = "field"; fontFileLabel.append(node("span", "自定义字体文件"), fontFile); sourcePanel.append(fontFileLabel);
    const size = field(parameterPanel, "像素尺寸 5–64", existing?.size ?? 16, parametersChanged, fail) as HTMLInputElement;
    const threshold = field(parameterPanel, "阈值 0–255", existing?.threshold ?? 128, parametersChanged, fail) as HTMLInputElement;
    const thresholdRange = node("input"); thresholdRange.type = "range"; thresholdRange.min = "0"; thresholdRange.max = "255"; thresholdRange.step = "1"; thresholdRange.value = threshold.value;
    thresholdRange.setAttribute("aria-label", "字形取模阈值");
    thresholdRange.addEventListener("input", () => { threshold.value = thresholdRange.value; parametersChanged(); });
    threshold.addEventListener("change", () => { if (Number(threshold.value) >= 0 && Number(threshold.value) <= 255) thresholdRange.value = threshold.value; });
    parameterPanel.append(thresholdRange);
    const text = field(charsPanel, "提取字符", existing ? existing.coverage.map(code => String.fromCodePoint(code)).join("") : "中文界面",
      parametersChanged, fail, undefined, true) as HTMLTextAreaElement;
    const textFile = node("input"); textFile.type = "file"; textFile.accept = ".txt";
    const textFileLabel = node("label"); textFileLabel.className = "field"; textFileLabel.append(node("span", "UTF-8 字符文本"), textFile); charsPanel.append(textFileLabel);
    textFile.addEventListener("change", () => {
      const file = textFile.files?.[0];
      void (async () => {
        if (!file || file.size > 128 * 1024) throw new Error("请选择不超过 128 KiB 的 UTF-8 字符文本");
        const chars = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        if (token === generation) { text.value = chars; parametersChanged(); }
      })().catch(fail);
    });
    charsPanel.append(button("收集项目全部文字", () => {
      text.value = getProject().pages.flatMap(page => page.components.filter(component => component.type === "ascii" || component.type === "chinese")
        .map(component => "text" in component ? component.text : "")).join("\n"); parametersChanged();
    }, fail));
    const info = node("p", source ? existing?.sourceName ?? existing?.name ?? "项目保存的源字体" : "请选择源字体");
    const search = node("input"); search.placeholder = "搜索电脑字体"; const select = node("select");
    search.setAttribute("aria-label", "搜索电脑字体"); select.setAttribute("aria-label", "电脑字体样式");
    function populate(): void {
      select.replaceChildren(new Option("请选择电脑字体", ""));
      for (const font of filterLocalFonts(fonts, search.value)) select.add(new Option(`${font.fullName} · ${font.style}`, font.postscriptName));
    }
    search.addEventListener("input", populate);
    sourcePanel.append(button("授权读取电脑字体", async () => {
      const available = await listLocalFonts();
      if (token !== generation) return;
      fonts = available; populate(); notify(`已读取 ${fonts.length} 款字体`);
    }, fail), search, select, button("使用选中的电脑字体", async () => {
      const font = fonts.find(font => font.postscriptName === select.value); if (!font) throw new Error("请先选择电脑字体");
      const job = ++reading;
      const bytes = new Uint8Array(await readLocalFont(font));
      if (token !== generation || job !== reading) return;
      source = bytes; postscriptName = font.postscriptName; parametersChanged(); info.textContent = font.fullName; meta.name.value = font.fullName;
    }, fail), info);
    fontFile.addEventListener("change", () => {
      const file = fontFile.files?.[0];
      const job = ++reading;
      void (async () => {
        if (!file || file.size > 32 * 1024 * 1024) throw new Error("请选择不超过 32 MiB 的静态 TTF/OTF 文件");
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (token !== generation || job !== reading) return;
        source = bytes; postscriptName = ""; parametersChanged(); info.textContent = file.name; meta.name.value = file.name.replace(/\.(ttf|otf)$/i, "");
      })().catch(fail);
    });
    const generate = button("生成并加入 / 替换字库", async () => {
      if (!source) throw new Error("请选择源字体");
      generate.disabled = true;
      const original = source, fontSize = size.valueAsNumber, fontThreshold = threshold.valueAsNumber, chars = text.value;
      try {
        result = await tool.generate({ source: original.slice().buffer, sourceName: info.textContent ?? meta.name.value, sourcePostscriptName: postscriptName,
          size: fontSize, threshold: fontThreshold, text: chars, symbol: fontSymbol(meta.name.value) },
        (done, total) => notify(`正在生成字形 ${done}/${total}`));
        if (token !== generation) return;
        if (source !== original || Number(size.value) !== fontSize || Number(threshold.value) !== fontThreshold || text.value !== chars) {
          result = undefined; throw new Error("生成期间参数已修改，请重新生成；旧资源未替换");
        }
        const applied = apply({ id: meta.resourceId, name: meta.name.value, license: meta.license.value, kind: "font",
          data: result.bytes, coverage: result.coverage, source: original, postscriptName,
          size: fontSize, threshold: fontThreshold, sourceName: result.parameters.sourceName }, meta.projectId);
        outputStatus.textContent = `生成完成：${result.coverage.length} 字符 · ${result.bytes.length} B · ${fontSize} px · 阈值 ${fontThreshold}；${applied ? "已加入项目，请检查字形和资源绑定。" : "已取消替换，项目保留旧字库；下方仅为新生成预览。"}`;
        outputPreview.replaceChildren();
        fontPreview(outputPreview, 0, result.bytes, result.coverage.slice(0, 12).map(code => String.fromCodePoint(code)).join(""));
      } finally { generate.disabled = false; }
    }, fail);
    generate.className = "primary";
    outputPanel.append(generate, button("取消", () => tool.cancel(), fail), button("下载 BDF / C", () => {
      if (!result) throw new Error("请先生成当前参数字库");
      const resources = getProject().resources.map(resource => resource.id === meta.resourceId ?
        { ...resource, name: meta.name.value } : resource);
      if (!resources.some(resource => resource.id === meta.resourceId))
        resources.push({ id: meta.resourceId, name: meta.name.value, kind: "font", license: meta.license.value, data: result.bytes, coverage: result.coverage });
      const names = fontResourceNames(resources);
      const name = names.get(meta.resourceId)!;
      download(`${name}.bdf`, result.bdf);
      download(`${name}.c`, `#include "u8g2.h"\n/* ${JSON.stringify({ name: meta.name.value, license: meta.license.value }).replace(/\*\//g, "* /")} */\n${fontC(result.bytes, name)}\n`);
    }, fail));
    if (existing) metadataPanel.append(button("保存名称和许可", () => { apply({ ...existing, name: meta.name.value, license: meta.license.value }, meta.projectId); }, fail));
    const external = node("details"); external.append(node("summary", "导入已有 U8g2 C / 二进制字库"));
    external.append(node("p", "已有压缩字库直接校验导入，不使用上方字号和阈值；重新生成需要源字体。支持单个受限 C 常量数组或二进制字库。"));
    const cfile = node("input"); cfile.type = "file"; cfile.accept = ".c,.h,.bin"; cfile.setAttribute("aria-label", "已有 U8g2 字库文件"); external.append(cfile,
      button("校验并导入字库", async () => {
        const file = cfile.files?.[0]; if (!file || file.size > 1024 * 1024) throw new Error("请选择不超过 1 MiB 的字库数据");
        const raw = new Uint8Array(await file.arrayBuffer());
        const bytes = /\.bin$/i.test(file.name) ? raw : parseFontC(new TextDecoder("utf-8", { fatal: true }).decode(raw)).bytes;
        if (token !== generation) return;
        apply({ id: meta.resourceId, name: meta.name.value, license: meta.license.value, kind: "font", data: bytes, coverage: inspectFont(bytes) }, meta.projectId);
      }, fail)); editor.append(external);
    cfile.addEventListener("change", () => {
      const file = cfile.files?.[0];
      if (file) meta.name.value = file.name.replace(/\.(c|h|bin)$/i, "");
    });
  }
  function drawingEditor(existing?: Extract<Resource, { kind: "image" }>): void {
    categoryView("image");
    const meta = metadata(existing);
    const width = 512, height = 512;
    let zoom = 6;
    let bits: Uint8Array = new Uint8Array(width * height);
    if (existing) {
      const original = unpackXbm(existing.width, existing.height, existing.data);
      for (let y = 0; y < existing.height; y++) bits.set(original.subarray(y * existing.width, (y + 1) * existing.width), y * width);
    }
    const undo: Uint8Array[] = [], redo: Uint8Array[] = [];
    let stroke: { before: Uint8Array; x: number; y: number; pointer: number; erase: boolean } | undefined;
    const mode = node("div"); mode.className = "buttons";
    mode.append(button("导入 / 取模模式", () => {
      if (confirm("切换到取模模式？未保存的绘制将丢弃。")) imageEditor(existing);
    }, fail), node("strong", "手工绘制模式")); editor.append(mode);
    editor.append(node("p", "左键绘制，右键擦除；每一笔形成一次撤销。512×512 工作区可滚动，图片大小按实际亮点自动计算，保存时裁掉外围空白。空白图不能保存；缩放不改变像素。"));
    const controls = node("div"), viewport = node("div"), canvas = node("canvas"), status = node("p");
    viewport.className = "image-preview-viewport"; canvas.id = "drawing-canvas"; canvas.style.touchAction = "none";
    viewport.append(canvas); editor.append(controls, viewport, status);
    function render(): void {
      showPixels(canvas, bits, width, height); canvas.style.width = `${width * zoom}px`; canvas.style.height = `${height * zoom}px`;
      const bounds = bitmapBounds(width, height, bits);
      status.textContent = bounds ? `实际图片 ${bounds.width} × ${bounds.height} · ${Math.ceil(bounds.width / 8) * bounds.height} B · 起点 ${bounds.x}, ${bounds.y}；保存自动裁剪` : "尚无亮点；左键绘制，右键擦除";
      status.id = "drawing-status";
    }
    function finish(cancel = false): void {
      if (!stroke) return;
      const before = stroke.before; stroke = undefined;
      if (cancel) bits = before;
      else if (bits.some((value, index) => value !== before[index])) { undo.push(before); if (undo.length > 100) undo.shift(); redo.length = 0; }
      render();
    }
    function properties(): void {
      controls.replaceChildren();
      field(controls, "绘制缩放", zoom, value => {
        const next = Number(value); if (!Number.isInteger(next) || next < 1 || next > 32) throw new Error("缩放须为 1–32 整数");
        zoom = next; render();
      }, fail);
    }
    const tools = node("div"); tools.className = "buttons";
    tools.append(button("绘制撤销", () => { finish(); const previous = undo.pop(); if (previous) { redo.push(bits); bits = previous; render(); } }, fail),
      button("绘制重做", () => { finish(); const next = redo.pop(); if (next) { undo.push(bits); bits = next; render(); } }, fail),
      button("清空绘制", () => {
        if (!confirm("清空所有像素？可撤销。")) return;
        finish(); undo.push(bits); if (undo.length > 100) undo.shift(); redo.length = 0; bits = new Uint8Array(width * height); render();
      }, fail));
    viewport.before(tools);
    function point(event: PointerEvent): [number, number] {
      const rect = canvas.getBoundingClientRect();
      return [Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left) / zoom))),
        Math.max(0, Math.min(height - 1, Math.floor((event.clientY - rect.top) / zoom)))];
    }
    function paint(x: number, y: number): void {
      if (!stroke) return;
      let px = stroke.x, py = stroke.y;
      const dx = Math.abs(x - px), dy = -Math.abs(y - py), sx = px < x ? 1 : -1, sy = py < y ? 1 : -1;
      let error = dx + dy;
      while (true) {
        bits[py * width + px] = stroke.erase ? 0 : 1; if (px === x && py === y) break;
        const twice = error * 2; if (twice >= dy) { error += dy; px += sx; } if (twice <= dx) { error += dx; py += sy; }
      }
      stroke.x = x; stroke.y = y; render();
    }
    canvas.addEventListener("pointerdown", event => {
      if ((event.button !== 0 && event.button !== 2) || stroke) return;
      event.preventDefault(); const [x, y] = point(event);
      stroke = { before: bits.slice(), x, y, pointer: event.pointerId, erase: event.button === 2 }; canvas.setPointerCapture(event.pointerId); paint(x, y);
    });
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointermove", event => { if (stroke?.pointer === event.pointerId) paint(...point(event)); });
    canvas.addEventListener("pointerup", () => finish());
    canvas.addEventListener("pointercancel", () => finish(true));
    disposeImage = () => { stroke = undefined; };
    editor.append(button("保存绘制图片", () => {
      finish(); apply({ id: meta.resourceId, name: meta.name.value, license: meta.license.value, kind: "image",
        ...cropBitmap(width, height, bits) }, meta.projectId);
    }, fail));
    properties(); render();
  }
  for (const [selector, kind] of [["#resource-images-tab", "image"], ["#resource-fonts-tab", "font"]] as const) {
    element(selector).addEventListener("click", () => {
      if (kind === category) return;
      if (editor.children.length && !confirm("切换资源分类？未提交的编辑内容将丢弃，已保存的项目资源不变。")) return;
      reset(); selected = ""; categoryView(kind); refresh();
    });
  }
  element("#new-image").addEventListener("click", () => imageEditor());
  element("#new-font").addEventListener("click", () => fontEditor());
  element("#resource-search").addEventListener("input", refresh);
  element("#close-resources").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", reset);
  return (resourceId, createImage) => {
    reset(); selected = "";
    refresh();
    if (createImage) imageEditor();
    else if (resourceId) {
      const resource = getProject().resources.find(value => value.id === resourceId);
      if (!resource) throw new Error("资源不存在"); edit(resource);
    }
    dialog.showModal();
  };
}
