import assert from "node:assert/strict";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const build = path.join(root, "build");
const url = pathToFileURL(path.join(root, "dist", "oled-lab.html")).href;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const report = { offline: true, thresholds: [], localFont: false, localChineseFont: false, deniedPermission: false, unsupportedBrowser: false };
async function generate(page) {
  await page.locator("#convert").click();
  await page.waitForFunction(() => document.querySelector("#convert").disabled, null, { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector("#convert").disabled, null, { timeout: 30000 });
  assert.match(await page.locator("#status").textContent(), /生成并经 U8g2/);
  return page.evaluate(() => {
    const font = window.oledLab.fontResult();
    return { bdf: font.bdf, c: font.c, bytes: Array.from(font.bytes), parameters: font.parameters, preview: window.oledLab.preview() };
  });
}
async function verifyNative(font, name, text) {
  await writeFile(path.join(build, `${name}.bin`), new Uint8Array(font.bytes));
  await writeFile(path.join(build, `${name}.txt`), text);
  execFileSync(path.join(build, "reference.exe"), [`${name}.raw`, "0", `${name}.bin`, `${name}.txt`], { cwd: build });
  assert.deepEqual(font.preview, Array.from(await readFile(path.join(build, `${name}.raw`))));
}
try {
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const errors = [], network = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.goto(url);
  await page.waitForFunction(() => window.oledLab.ready);
  assert.equal(await page.locator("#pc-font-panel").isVisible(), false);
  await page.locator("#font-file").setInputFiles(path.join(build, "test-fonts", "NotoSansCJKsc-Regular.otf"));
  const text = "温度：25℃\n状态正常\nASCII gyp";
  await page.locator("#text").fill(text);
  const bitmaps = [];
  for (const threshold of [0, 64, 128, 220, 255]) {
    await page.locator("#threshold").fill(String(threshold));
    assert.equal(await page.locator("#threshold-range").inputValue(), String(threshold));
    const font = await generate(page);
    assert.equal(font.parameters.threshold, threshold);
    assert.match(font.c, new RegExp(`coverage threshold: ${threshold}/255`));
    assert.match(font.bdf, new RegExp(`COMMENT Coverage threshold ${threshold}/255`));
    const bits = Array.from(font.bdf.matchAll(/\nBITMAP\n([\s\S]*?)\nENDCHAR/g),
      match => [...match[1].replace(/\s/g, "")].flatMap(hex => {
        const value = parseInt(hex, 16);
        return [3, 2, 1, 0].map(bit => (value >> bit) & 1);
      })).flat();
    bitmaps.push(bits);
    await verifyNative(font, `threshold-${threshold}`, text);
    report.thresholds.push({ threshold, litPixels: bits.filter(Boolean).length, differentPixels: 0 });
  }
  for (let i = 1; i < bitmaps.length; i++) {
    assert.equal(bitmaps[i].length, bitmaps[0].length);
    for (let j = 0; j < bitmaps[i].length; j++) {
      assert.ok(bitmaps[i][j] <= bitmaps[i - 1][j], "raising threshold must never add a foreground pixel");
    }
  }
  assert.ok(report.thresholds[1].litPixels > report.thresholds[3].litPixels, "threshold must measurably affect glyph strokes");
  await page.locator("#threshold-range").fill("80");
  assert.equal(await page.locator("#threshold").inputValue(), "80");
  assert.match(await page.locator("#font-settings-state").textContent(), /参数已修改/);
  const valid = await page.evaluate(() => Array.from(window.oledLab.fontResult().bytes));
  for (const value of ["256", "-1", "12.5", ""]) {
    await page.locator("#threshold").fill(value);
    await page.locator("#convert").click();
    await page.waitForFunction(() => document.querySelector("#status").dataset.state === "error");
    assert.match(await page.locator("#status").textContent(), /阈值/);
    assert.deepEqual(await page.evaluate(() => Array.from(window.oledLab.fontResult().bytes)), valid);
  }
  await page.locator("#threshold").fill("80");
  await page.locator("#font-source").selectOption("pc");
  assert.equal(await page.locator("#pc-font-panel").isVisible(), true);
  assert.equal(await page.locator("#custom-font-panel").isVisible(), false);
  await page.locator("#convert").click();
  assert.match(await page.locator("#status").textContent(), /授权读取并选择/);

  await context.grantPermissions(["local-fonts"]);
  await page.locator("#load-pc-fonts").click();
  await page.waitForFunction(() => !document.querySelector("#pc-font-search").disabled, null, { timeout: 30000 });
  await page.locator("#pc-font-search").fill("Arial");
  await page.locator("#pc-font").selectOption("ArialMT");
  await page.locator("#text").fill("ASCII gyp 25");
  const local = await generate(page);
  assert.equal(local.parameters.threshold, 80);
  assert.match(local.parameters.sourceName, /Arial/);
  await verifyNative(local, "pc-font", "ASCII gyp 25");
  report.localFont = true;
  await page.locator("#pc-font-search").fill("");
  const chineseFont = await page.locator("#pc-font").evaluate(select =>
    ["MicrosoftYaHei", "SimSun"].find(name => Array.from(select.options).some(option => option.value === name)));
  if (chineseFont) {
    await page.locator("#pc-font").selectOption(chineseFont);
    await page.locator("#text").fill(text);
    const chinese = await generate(page);
    await verifyNative(chinese, "pc-chinese", text);
    report.localChineseFont = true;
  }
  await page.locator("#pc-font-search").fill("no-font-matches-this-unique-query");
  assert.equal(await page.locator("#pc-font").isDisabled(), true);
  await page.locator("#font-source").selectOption("custom");
  assert.equal(await page.locator("#font-file").inputValue() !== "", true, "switching sources must retain custom file");
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);

  const denied = await browser.newContext({ offline: true });
  const deniedPage = await denied.newPage();
  // Deterministically reproduce the browser's permission rejection without an interactive prompt.
  await deniedPage.addInitScript(() => {
    window.queryLocalFonts = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  await deniedPage.goto(url);
  await deniedPage.waitForFunction(() => window.oledLab.ready);
  await deniedPage.locator("#font-source").selectOption("pc");
  await deniedPage.locator("#load-pc-fonts").click();
  await deniedPage.waitForFunction(() => document.querySelector("#status").dataset.state === "error");
  assert.match(await deniedPage.locator("#status").textContent(), /未获授权/);
  report.deniedPermission = true;
  await denied.close();

  const unsupported = await browser.newContext({ offline: true });
  const unsupportedPage = await unsupported.newPage();
  await unsupportedPage.addInitScript(() => { window.queryLocalFonts = undefined; });
  await unsupportedPage.goto(url);
  await unsupportedPage.waitForFunction(() => window.oledLab.ready);
  await unsupportedPage.locator("#font-source").selectOption("pc");
  await unsupportedPage.locator("#load-pc-fonts").click();
  await unsupportedPage.waitForFunction(() => document.querySelector("#status").dataset.state === "error");
  assert.match(await unsupportedPage.locator("#status").textContent(), /不支持电脑字体/);
  report.unsupportedBrowser = true;
  await unsupported.close();
  await writeFile(path.join(root, "test-results", "font-options.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
