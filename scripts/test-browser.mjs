import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { parseFontC } from "../build/c-data.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const build = path.join(root, "build");
const results = path.join(root, "test-results");
await mkdir(results, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const report = { browser: await browser.version(), offline: false, fixture: {}, fonts: [], cppBridge: false, geometry: false, cancellation: false, largeSubset: {} };
try {
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const externalRequests = [];
  const errors = [];
  page.on("request", request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root, "dist", "oled-lab.html")).href);
  await page.waitForFunction(() => window.oledLab?.ready, { timeout: 30000 });
  report.offline = true;
  const full = await page.evaluate(() => window.oledLab.fixture(false));
  const paged = await page.evaluate(() => window.oledLab.fixture(true));
  execFileSync(path.join(build, "reference.exe"), ["native-full.raw", "0"], { cwd: build });
  execFileSync(path.join(build, "reference.exe"), ["native-page.raw", "1"], { cwd: build });
  const nativeFull = Array.from(await readFile(path.join(build, "native-full.raw")));
  const nativePage = Array.from(await readFile(path.join(build, "native-page.raw")));
  assert.deepEqual(full, nativeFull, "browser full vs native full");
  assert.deepEqual(paged, nativePage, "browser page vs native page");
  assert.deepEqual(full, paged, "full vs page");
  report.fixture = { pixels: full.length, differentPixels: 0, litPixels: full.filter(Boolean).length };

  execFileSync(path.join(build, "cpp_reference.exe"), ["native-cpp.raw"], { cwd: build });
  const bridge = await page.evaluate(() => {
    const r = window.oledLab.renderer();
    r._render_init(128, 64, 0); r._render_color(1);
    r._render_rect(3, 4, 10, 5, 1); r._render_circle(30, 15, 7, 0); r._render_font(1, 0);
    const data = new TextEncoder().encode("Bridge gyp\0"), ptr = r._malloc(data.length);
    r.HEAPU8.set(data, ptr); r._render_text(2, 45, ptr, 1); r._free(ptr);
    const p = r._render_pixels(); return Array.from(r.HEAPU8.slice(p, p + 128 * 64));
  });
  assert.deepEqual(bridge, Array.from(await readFile(path.join(build, "native-cpp.raw"))));
  report.cppBridge = true;
  const geometry = await page.evaluate(() => {
    const r = window.oledLab.renderer();
    const renderPolygon = points => {
      r._render_init(16, 16, 0); r._render_color(1);
      const coordinates = new Int16Array(points.flat());
      const pointer = r._malloc(coordinates.byteLength);
      r.HEAPU8.set(new Uint8Array(coordinates.buffer), pointer);
      r._render_polygon(pointer, points.length, 1); r._free(pointer);
      const p = r._render_pixels(); return Array.from(r.HEAPU8.slice(p, p + 256));
    };
    const points = [[1, 1], [11, 1], [11, 11], [6, 6], [1, 11]];
    const forward = renderPolygon(points), backward = renderPolygon(points.toReversed());
    const square = renderPolygon([[1, 1], [11, 1], [11, 11], [1, 11]]);
    r._render_init(16, 16, 0); r._render_color(1); r._render_rect(-2, -2, 4, 4, 1);
    const p = r._render_pixels();
    const clipped = Array.from(r.HEAPU8.slice(p, p + 256));
    return { forward, backward, square, clipped };
  });
  assert.deepEqual(geometry.forward, geometry.backward, "polygon winding must not change coverage");
  assert.equal(geometry.square.filter(Boolean).length, 100, "10x10 half-open polygon must cover exactly 100 pixels");
  assert.equal(geometry.clipped.filter(Boolean).length, 4, "negative rectangle must clip without wrapping");
  assert.deepEqual(geometry.clipped.slice(0, 3), [1, 1, 0]);
  report.geometry = true;

  for (const [file, text] of [
    ["NotoSansCJKsc-Regular.otf", "温度：25℃ / 状态正常\nASCII gyp"],
    ["MaShanZheng-Regular.ttf", "温度25 状态正常\nASCII gyp"],
  ]) {
    await page.locator("#font-file").setInputFiles(path.join(build, "test-fonts", file));
    await page.locator("#text").fill(text);
    const started = performance.now();
    await page.locator("#convert").click();
    await page.waitForFunction(() => document.querySelector("#convert").disabled, null, { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector("#convert").disabled, null, { timeout: 60000 });
    const status = await page.locator("#status").textContent();
    assert.match(status, /生成并经 U8g2/);
    const font = await page.evaluate(() => {
      const result = window.oledLab.fontResult();
      return { c: result.c, bytes: Array.from(result.bytes), bdf: result.bdf, coverage: result.coverage, preview: window.oledLab.preview() };
    });
    const sourceDifferences = await page.evaluate(font => {
      const r = window.oledLab.renderer();
      const data = new Uint8Array(font.bytes), pointer = r._malloc(data.length);
      r.HEAPU8.set(data, pointer);
      let differences = 0;
      for (const match of font.bdf.matchAll(/ENCODING (\d+)[\s\S]*?BBX (\d+) (\d+) (-?\d+) (-?\d+)\nBITMAP\n([\s\S]*?)\nENDCHAR/g)) {
        const [, encoding, w, h, offsetX, offsetY, bitmap] = match;
        const width = Number(w), height = Number(h), x = 32 + Number(offsetX), y = 32 - Number(offsetY) - height;
        const rows = bitmap.trim() ? bitmap.trim().split("\n") : [];
        const expected = new Uint8Array(8192);
        for (let row = 0; row < height; row++) {
          for (let column = 0; column < width; column++) {
            const byte = parseInt(rows[row].slice((column >> 3) * 2, (column >> 3) * 2 + 2), 16);
            expected[(y + row) * 128 + x + column] = (byte >> (7 - (column & 7))) & 1;
          }
        }
        r._render_init(128, 64, 0); r._render_font(0, pointer); r._render_color(1);
        const text = new TextEncoder().encode(String.fromCodePoint(Number(encoding)) + "\0"), t = r._malloc(text.length);
        r.HEAPU8.set(text, t); r._render_text(32, 32, t, 1); r._free(t);
        const p = r._render_pixels(), actual = r.HEAPU8.slice(p, p + 8192);
        for (let i = 0; i < expected.length; i++) if (expected[i] !== actual[i]) differences++;
      }
      r._free(pointer);
      return differences;
    }, font);
    assert.equal(sourceDifferences, 0, "decoded glyphs must match the actual pre-compression BDF bitmaps");
    const fontName = file.endsWith(".otf") ? "otf" : "ttf";
    await writeFile(path.join(build, `${fontName}.bin`), new Uint8Array(font.bytes));
    await writeFile(path.join(build, `${fontName}.bdf`), font.bdf);
    await writeFile(path.join(build, `${fontName}.txt`), text);
    execFileSync(path.join(build, "reference.exe"), [`${fontName}.raw`, "0", `${fontName}.bin`, `${fontName}.txt`], { cwd: build });
    execFileSync(path.join(build, "reference.exe"), [`${fontName}-page.raw`, "1", `${fontName}.bin`, `${fontName}.txt`], { cwd: build });
    const native = Array.from(await readFile(path.join(build, `${fontName}.raw`)));
    assert.deepEqual(font.preview, native, "generated font browser vs native");
    assert.deepEqual(native, Array.from(await readFile(path.join(build, `${fontName}-page.raw`))), "generated font page vs full");
    // The upstream repository ships a Windows converter: compare its encoding too.
    execFileSync(path.join(build, "bdfconv.exe"), [
      "-f", "1", "-m", font.coverage.join(","), "-n", "oled_custom_font",
      "-o", `${fontName}-native.c`, `${fontName}.bdf`,
    ], { cwd: build });
    const nativeEncoded = parseFontC(await readFile(path.join(build, `${fontName}-native.c`), "utf8"));
    await writeFile(path.join(build, `${fontName}-native.bin`), nativeEncoded.bytes);
    execFileSync(path.join(build, "reference.exe"), [`${fontName}-encoded.raw`, "0", `${fontName}-native.bin`, `${fontName}.txt`], { cwd: build });
    assert.deepEqual(native, Array.from(await readFile(path.join(build, `${fontName}-encoded.raw`))), "upstream Windows converter must decode to identical pixels");
    report.fonts.push({
      source: file, characters: font.coverage.length, bytes: font.bytes.length,
      upstreamWindowsBytes: nativeEncoded.bytes.length, differentPixels: 0,
      durationMs: Math.round(performance.now() - started),
    });
    await page.screenshot({ path: path.join(results, `${fontName}.png`), fullPage: true });
  }
  await page.locator("#text").fill("不在已生成字库的字😀");
  await page.locator("#preview-font").click();
  assert.equal(await page.locator("#status").getAttribute("data-state"), "error");
  assert.match(await page.locator("#status").textContent(), /缺字|不支持/);
  await page.locator("#font-file").setInputFiles(path.join(build, "test-fonts", "NotoSansCJKsc-Regular.otf"));
  const subset = Array.from({ length: 1000 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
  await page.locator("#text").fill(subset);
  await page.locator("#convert").click();
  await page.locator("#cancel").click();
  await page.waitForTimeout(300);
  assert.match(await page.locator("#status").textContent(), /已取消/);
  assert.equal(await page.locator("#convert").isEnabled(), true);
  report.cancellation = true;
  const started = performance.now();
  await page.locator("#convert").click();
  await page.waitForFunction(() => document.querySelector("#convert").disabled, null, { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector("#convert").disabled, null, { timeout: 60000 });
  assert.match(await page.locator("#status").textContent(), /生成并经 U8g2/);
  const larger = await page.evaluate(() => {
    const f = window.oledLab.fontResult();
    return { characters: f.coverage.length, bytes: f.bytes.length, preview: window.oledLab.preview(), c: f.c, data: Array.from(f.bytes) };
  });
  assert.equal(larger.characters, 1000);
  assert.ok(larger.preview.some(Boolean), "large Chinese subset must produce visible pixels");
  assert.match(larger.c.slice(-300), /#else\s+#error/);
  assert.deepEqual(Array.from(parseFontC(larger.c).bytes), larger.data, "large exported C must reimport exactly");
  await writeFile(path.join(build, "large-subset.c"), larger.c);
  await writeFile(path.join(build, "large-subset.bin"), new Uint8Array(larger.data));
  await writeFile(path.join(build, "large-subset.txt"), subset);
  execFileSync(path.join(build, "reference.exe"), ["large-subset.raw", "0", "large-subset.bin", "large-subset.txt"], { cwd: build });
  assert.deepEqual(larger.preview, Array.from(await readFile(path.join(build, "large-subset.raw"))), "large-font preview vs native");
  report.largeSubset = { characters: larger.characters, bytes: larger.bytes, durationMs: Math.round(performance.now() - started) };
  assert.deepEqual(externalRequests, [], "offline page must not request network resources");
  assert.deepEqual(errors, [], "browser must not emit uncaught errors");
  await writeFile(path.join(results, "phase0.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
