import test from "node:test";
import assert from "node:assert/strict";
import { packXbm, unpackXbm } from "../build/bitmap.mjs";
import { validatePolygon } from "../build/geometry.mjs";
import { parseFontC, parseCUnsigned } from "../build/c-data.mjs";
import { isGlyphPixel, validateThreshold } from "../build/font-threshold.mjs";
import { filterLocalFonts } from "../build/local-fonts.mjs";
import { prepareFontSource } from "../build/font-source.mjs";

test("XBM packs each row separately, LSB-first", () => {
  for (const [width, height] of [[13, 3], [1, 8], [9, 1]]) {
    const bits = Uint8Array.from({ length: width * height }, (_, i) => i % 3 === 0 ? 1 : 0);
    const packed = packXbm(width, height, bits);
    assert.equal(packed.length, Math.ceil(width / 8) * height);
    assert.deepEqual(unpackXbm(width, height, packed), bits);
  }
  assert.deepEqual(packXbm(9, 1, [1, 0, 0, 0, 0, 0, 0, 1, 1]), new Uint8Array([0x81, 1]));
  assert.throws(() => unpackXbm(13, 3, new Uint8Array(5)), /长度/);
  assert.throws(() => packXbm(1, 1, [2]), /0 或 1/);
});

test("polygon validation supports concavity but rejects invalid fill", () => {
  const concave = [[0, 0], [10, 0], [10, 10], [5, 5], [0, 10]];
  assert.doesNotThrow(() => validatePolygon(concave, true));
  assert.doesNotThrow(() => validatePolygon(concave.toReversed(), true));
  assert.throws(() => validatePolygon([[0, 0], [10, 10], [0, 10], [10, 0]], true), /自交/);
  assert.throws(() => validatePolygon([[0, 0], [10, 0], [0, 0]], false), /重复/);
  assert.throws(() => validatePolygon([[0, 0], [1.5, 5], [0, 10]], true), /整数/);
  assert.throws(() => validatePolygon([[0, 0], [5, 0], [10, 0]], true), /回折|退化/);
});

test("C font data parser never accepts code or expressions", () => {
  assert.throws(() => parseFontC('const uint8_t f[1] = {alert(1)};'), /整数常量/);
  assert.throws(() => parseFontC('const uint8_t f[1] = {256};'), /超出/);
  assert.throws(() => parseFontC('const uint8_t f[1] = "\\q";'), /转义/);
  assert.throws(() => parseFontC('const uint8_t f[1] = {1}; system("x");'), /格式错误/);
});
test("C integer parsing preserves octal semantics rather than silently reading decimal", () => {
  assert.equal(parseCUnsigned("0255",255),173);
  assert.equal(parseCUnsigned("0xff",255),255);
  assert.equal(parseCUnsigned("255",255),255);
  assert.throws(()=>parseCUnsigned("08",255),/整数常量/);
  assert.throws(()=>parseCUnsigned("256",255),/超出/);
});

test("font threshold uses inclusive coverage without lighting blank background", () => {
  for (const threshold of [0, 64, 128, 255]) {
    assert.doesNotThrow(() => validateThreshold(threshold));
    assert.equal(isGlyphPixel(0, threshold), false);
    assert.equal(isGlyphPixel(255, threshold), true);
  }
  assert.equal(isGlyphPixel(128, 128), true);
  assert.equal(isGlyphPixel(127, 128), false);
  for (const threshold of [-1, 256, 1.2, NaN]) assert.throws(() => validateThreshold(threshold), /阈值/);
});

test("computer font search includes family, full name and style", () => {
  const fonts = [{ family: "Arial", fullName: "Arial Bold", style: "Bold", postscriptName: "Arial-BoldMT" },
    { family: "Example", fullName: "Example Regular", style: "Regular", postscriptName: "Example-Regular" }];
  assert.equal(filterLocalFonts(fonts, " arIAL ").length, 1);
  assert.equal(filterLocalFonts(fonts, "BOLDMT").length, 1);
  assert.equal(filterLocalFonts(fonts, "").length, 2);
  assert.equal(filterLocalFonts(fonts, "missing").length, 0);
});

function collection() {
  const source = new ArrayBuffer(512), view = new DataView(source);
  view.setUint32(0, 0x74746366); view.setUint32(4, 0x10000); view.setUint32(8, 2);
  view.setUint32(12, 64); view.setUint32(16, 128);
  for (const [index, name] of ["Example-Regular", "Example-Bold"].entries()) {
    const face = index ? 128 : 64, head = 200 + index * 16, naming = 240 + index * 100;
    view.setUint32(face, 0x10000); view.setUint16(face + 4, 2);
    view.setUint32(face + 12, 0x68656164); view.setUint32(face + 20, head); view.setUint32(face + 24, 12);
    view.setUint32(face + 28, 0x6e616d65); view.setUint32(face + 36, naming); view.setUint32(face + 40, 18 + name.length * 2);
    view.setUint32(head, 0x10000);
    view.setUint16(naming + 2, 1); view.setUint16(naming + 4, 18);
    view.setUint16(naming + 6, 3); view.setUint16(naming + 8, 1); view.setUint16(naming + 10, 0x409);
    view.setUint16(naming + 12, 6); view.setUint16(naming + 14, name.length * 2);
    for (let i = 0; i < name.length; i++) view.setUint16(naming + 18 + i * 2, name.charCodeAt(i));
  }
  return source;
}

test("TTC extraction selects the exact style, relocates tables and updates checksums", () => {
  const source = collection(), selected = prepareFontSource(source, "Example-Bold");
  const view = new DataView(selected);
  assert.equal(view.getUint32(0), 0x10000);
  assert.equal(view.getUint16(4), 2);
  assert.equal(view.getUint32(20), 44);
  assert.equal(view.getUint32(36), 56);
  let sum = 0;
  for (let i = 0; i < selected.byteLength; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  assert.equal(sum, 0xb1b0afba);
  assert.notDeepEqual(new Uint8Array(selected), new Uint8Array(prepareFontSource(source, "Example-Regular")));
  assert.throws(() => prepareFontSource(source, "MissingStyle"), /未找到/);
  assert.throws(() => prepareFontSource(source, ""), /自定义导入/);
  const corrupt = collection();
  new DataView(corrupt).setUint32(36 + 64, 9999);
  assert.throws(() => prepareFontSource(corrupt, "Example-Bold"), /范围/);
  assert.throws(() => prepareFontSource(new ArrayBuffer(4), ""), /不完整/);
});
