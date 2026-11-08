export interface LocalFont {
  family: string;
  fullName: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFont[]>;
  }
}

export async function listLocalFonts(): Promise<LocalFont[]> {
  if (!window.isSecureContext || !window.queryLocalFonts) {
    throw new Error("当前浏览器不支持电脑字体访问。请使用桌面 Chrome/Edge，或通过“自定义导入”选择电脑上的 TTF/OTF 文件。");
  }
  let fonts: LocalFont[];
  try {
    fonts = await window.queryLocalFonts();
  } catch (error) {
    if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
      throw new Error("电脑字体访问未获授权。请在浏览器中允许字体访问后重试，或使用自定义导入。", { cause: error });
    }
    throw new Error(`读取电脑字体失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (fonts.length === 0) throw new Error("浏览器未返回可访问的电脑字体，请使用自定义导入。");
  return [...fonts].sort((a, b) => a.family.localeCompare(b.family, "zh-CN") ||
    a.fullName.localeCompare(b.fullName, "zh-CN") || a.postscriptName.localeCompare(b.postscriptName));
}

export function filterLocalFonts(fonts: readonly LocalFont[], query: string): LocalFont[] {
  const search = query.trim().toLocaleLowerCase();
  return fonts.filter(font => `${font.family} ${font.fullName} ${font.style} ${font.postscriptName}`.toLocaleLowerCase().includes(search));
}

export async function readLocalFont(font: LocalFont): Promise<ArrayBuffer> {
  const blob = await font.blob();
  if (blob.size === 0) throw new Error("所选电脑字体没有可读取的数据");
  if (blob.size > 32 * 1024 * 1024) throw new Error("所选电脑字体超过 32 MiB 验证版限制");
  return blob.arrayBuffer();
}
