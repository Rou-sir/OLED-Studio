export function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`界面元素不存在：${selector}`);
  return result;
}
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result;
}
export function button(text: string, action: () => void | Promise<void>, fail: (error: unknown) => void): HTMLButtonElement {
  const result = node("button", text);
  result.addEventListener("click", () => { void Promise.resolve().then(action).catch(fail); });
  return result;
}
export function field(parent: HTMLElement, title: string, value: string | number | boolean,
  change: (value: string | number | boolean) => void, fail: (error: unknown) => void,
  choices?: readonly { value: string; label: string }[], multiline = false, eventName: "change" | "input" = "change"): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const label = node("label"); label.className = "field"; label.append(node("span", title));
  const input = choices ? node("select") : multiline ? node("textarea") : node("input");
  if (input instanceof HTMLSelectElement && choices) for (const choice of choices) input.add(new Option(choice.label, choice.value));
  if (input instanceof HTMLInputElement) {
    input.type = typeof value === "number" ? "number" : typeof value === "boolean" ? "checkbox" : "text";
    if (typeof value === "boolean") input.checked = value;
  }
  input.value = String(value); label.append(input); parent.append(label);
  input.addEventListener(eventName, () => {
    try {
      if (typeof value === "number" && (!input.value.trim() || !Number.isFinite(Number(input.value)))) throw new Error(`${title} 必须是有效数字`);
      change(typeof value === "boolean" ? (input as HTMLInputElement).checked : typeof value === "number" ? Number(input.value) : input.value);
    }
    catch (error) { input.value = String(value); if (input instanceof HTMLInputElement && typeof value === "boolean") input.checked = value; fail(error); }
  });
  return input;
}
export function download(name: string, data: Uint8Array | string, type = "application/octet-stream"): void {
  const url = URL.createObjectURL(new Blob([typeof data === "string" ? data : data.slice().buffer], { type }));
  const anchor = node("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function showPixels(canvas: HTMLCanvasElement, pixels: Uint8Array, width: number, height: number,
  litColor: readonly [number, number, number] = [235, 235, 235]): void {
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("无法创建预览画布");
  const image = context.createImageData(width, height);
  for (let index = 0; index < pixels.length; index++) {
    image.data.set(pixels[index] ? [...litColor, 255] : [0, 0, 0, 255], index * 4);
  }
  context.putImageData(image, 0, 0);
}
