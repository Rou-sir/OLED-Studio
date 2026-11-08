import assert from "node:assert/strict";
import { CPU, avrInstruction, AVRUSART, usart0Config } from "avr8js";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { parseFontC } from "../build/c-data.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const firmware = await readFile(path.join(root, "build", "avr-flash.bin"));
const program = new Uint16Array(16384);
new Uint8Array(program.buffer).set(firmware);
const cpu = new CPU(program, 2048);
const uart = new AVRUSART(cpu, usart0Config, 16000000);
const transmitted = [];
uart.onByteTransmit = byte => transmitted.push(byte);
const maxCycles = 16000000 * 10;
while (transmitted.length < 1026 && cpu.cycles < maxCycles) {
  avrInstruction(cpu);
  cpu.tick();
}
assert.equal(transmitted.length, 1026, "AVR firmware must emit header and complete framebuffer");
assert.deepEqual(transmitted.slice(0, 2), [0x4f, 0x4c]);
const font = parseFontC(await readFile(path.join(root, "build", "target_font.c"), "utf8"));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
try {
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(root, "dist", "oled-lab.html")).href);
  await page.waitForFunction(() => window.oledLab?.ready);
  const expected = await page.evaluate(data => {
    const r = window.oledLab.renderer();
    r._render_init(128, 64, 0);
    r._render_color(0); r._render_rect(0, 0, 128, 64, 1);
    r._render_color(1); r._render_rect(0, 0, 128, 64, 0);
    let p = r._malloc(6);
    r.HEAPU8.set([0x55, 0x15, 0xaa, 0x0a, 0xff, 0x1f], p);
    r._render_bitmap(2, 2, 13, 3, p, 1); r._free(p);
    p = r._malloc(data.length); r.HEAPU8.set(data, p); r._render_font(0, p);
    const text = new TextEncoder().encode("温度：25℃\0"), t = r._malloc(text.length);
    r.HEAPU8.set(text, t); r._render_text(2, 25, t, 1);
    r._free(t); r._free(p);
    const result = r._render_pixels();
    return Array.from(r.HEAPU8.slice(result, result + 8192));
  }, Array.from(font.bytes));
  const actual = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    actual.push((transmitted[2 + (y >> 3) * 128 + x] >> (y & 7)) & 1);
  }
  assert.deepEqual(actual, expected, "AVR PROGMEM glyph and XBMP reads must match browser pixel output");
  const report = {
    processor: "ATmega328P", engine: "avr8js", firmwareBytes: firmware.length,
    cycles: cpu.cycles, pixels: actual.length, differentPixels: 0,
    hardwareVerified: false,
  };
  await writeFile(path.join(root, "test-results", "avr.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
