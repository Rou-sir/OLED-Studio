export function validateThreshold(threshold: number): void {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error("取模阈值须为 0–255 的整数");
  }
}

export function isGlyphPixel(alpha: number, threshold: number): boolean {
  return alpha > 0 && alpha >= threshold;
}
