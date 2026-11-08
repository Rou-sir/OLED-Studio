import { inspectFont } from "./font-validation";

export function parseCUnsigned(token: string, maximum: number): number {
  if (!/^(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)$/.test(token)) throw new Error("字节数组只接受整数常量（0–255 整数字节），不执行表达式");
  const value = /^0[0-7]+$/.test(token) ? parseInt(token, 8) : Number(token);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`数据整数超出 0–${maximum}`);
  return value;
}
export function parseFontC(source: string): { symbol: string; bytes: Uint8Array } {
  let clean = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "")
    .replace(/^\s*#include\s+"u8g2\.h"\s*$/gm, "").trim();
  const largeGuard = /^#ifdef\s+U8G2_USE_LARGE_FONTS\s*\n([\s\S]*?)\n(?:#else\s*\n#error\s+"[^"\r\n]*"\s*\n)?#endif$/.exec(clean);
  if (largeGuard) clean = largeGuard[1]!.trim();
  const declaration = /^(?:static\s+)?const\s+(?:uint8_t|unsigned\s+char)\s+([A-Za-z_]\w*)\s*\[(\d*)\]\s*(?:U8G2_FONT_SECTION\s*\(\s*"[^"]*"\s*\)|U8X8_PROGMEM|PROGMEM)?\s*=\s*([\s\S]+);\s*$/.exec(clean);
  if (!declaration) throw new Error("只支持单个常量 U8g2 字库声明，不执行 C 代码或宏");
  const [, symbol, size, body] = declaration;
  if (!symbol || !body) throw new Error("字库声明不完整");
  const values: number[] = [];
  if (body.trim().startsWith("{")) {
    const array = /^\{\s*([\s\S]*?)\s*\}$/.exec(body.trim());
    if (!array) throw new Error("字库数组格式错误");
    const tokens = array[1]!.split(",").map(value => value.trim());
    if (tokens.at(-1) === "") tokens.pop();
    for (const token of tokens) {
      values.push(parseCUnsigned(token, 255));
    }
  } else {
    let remaining = body.trim();
    while (remaining) {
      const match = /^"((?:[^"\\]|\\[\s\S])*)"\s*/.exec(remaining);
      if (!match) throw new Error("字库只支持连续 C 字符串常量");
      const raw = match[1]!;
      for (let index = 0; index < raw.length; index++) {
        const char = raw[index]!;
        if (char !== "\\") {
          const value = char.charCodeAt(0);
          if (value < 32 || value > 126) throw new Error("C 字符串包含非 ASCII 原始字符");
          values.push(value);
          continue;
        }
        index++;
        const escape = raw[index];
        if (!escape) throw new Error("C 字符串转义不完整");
        if (/[0-7]/.test(escape)) {
          const octal = /^[0-7]{1,3}/.exec(raw.slice(index))![0];
          const value = parseInt(octal, 8);
          if (value > 255) throw new Error("八进制转义超出单字节");
          values.push(value); index += octal.length - 1;
        } else if (escape === "x") {
          const hex = /^[0-9a-fA-F]+/.exec(raw.slice(index + 1))?.[0];
          if (!hex || parseInt(hex, 16) > 255) throw new Error("十六进制转义无效或超出单字节");
          values.push(parseInt(hex, 16)); index += hex.length;
        } else {
          const escapes: Record<string, number> = { n: 10, r: 13, t: 9, "\\": 92, '"': 34, "'": 39, "?": 63, a: 7, b: 8, f: 12, v: 11 };
          const value = escapes[escape];
          if (value === undefined) throw new Error(`不支持的 C 转义：\\${escape}`);
          values.push(value);
        }
      }
      remaining = remaining.slice(match[0].length);
    }
    const declared = size ? parseCUnsigned(size, 65535) : values.length + 1;
    if (declared === values.length + 1) values.push(0);
  }
  if (size && parseCUnsigned(size, 65535) !== values.length) throw new Error("字库声明长度与数据不符");
  const bytes = new Uint8Array(values);
  validateFont(bytes);
  return { symbol, bytes };
}

export function validateFont(bytes: Uint8Array): void {
  inspectFont(bytes);
}
