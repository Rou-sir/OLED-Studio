import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");
await mkdir(dist, { recursive: true });
const renderer = await readFile(path.join(root, "build", "renderer.js"), "utf8");
const converter = await readFile(path.join(root, "build", "bdfconv.js"), "utf8");
async function bundle(entry) {
  const result = await build({
    entryPoints: [path.join(root, "src", entry)], bundle: true, write: false,
    format: "iife", platform: "browser", target: "chrome110", minify: false,
  });
  return result.outputFiles[0].text;
}
const worker = converter + "\n" + await bundle("font-worker.ts");
const app = "const OLED_WORKER_SOURCE = " + JSON.stringify(worker) + ";\n" + await bundle("lab.ts");
const escapeScript = text => text.replace(/<\/script/gi, "<\\/script");
const template = await readFile(path.join(root, "src", "lab.html"), "utf8");
const html = template.replace("/*STYLE*/", await readFile(path.join(root, "src", "lab.css"), "utf8"))
  .replace("/*RUNTIME*/", () => escapeScript(renderer))
  .replace("/*APP*/", () => escapeScript(app));
await writeFile(path.join(dist, "oled-lab.html"), html);
const studio = "const OLED_WORKER_SOURCE = " + JSON.stringify(worker) + ";\nconst OLED_POLYGON_SOURCE = " +
  JSON.stringify(await readFile(path.join(root, "native", "polygon.h"), "utf8")) + ";\nconst OLED_U8G2_LICENSE = " +
  JSON.stringify(await readFile(path.join(root, "vendor", "u8g2", "LICENSE"), "utf8")) + ";\n" + await bundle("studio.ts");
const studioHtml = (await readFile(path.join(root, "src", "studio.html"), "utf8"))
  .replace("/*STYLE*/", await readFile(path.join(root, "src", "studio.css"), "utf8"))
  .replace("/*RUNTIME*/", () => escapeScript(renderer)).replace("/*APP*/", () => escapeScript(studio));
await writeFile(path.join(dist, "oled-studio.html"), studioHtml);
await copyFile(path.join(root, "vendor", "u8g2", "LICENSE"), path.join(dist, "U8g2-LICENSE.txt"));
await copyFile(path.join(root, "node_modules", "opentype.js", "LICENSE"), path.join(dist, "opentype-LICENSE.txt"));
await copyFile(path.join(root, "node_modules", "fflate", "LICENSE"), path.join(dist, "fflate-LICENSE.txt"));
for (const entry of ["c-data", "fixture", "runtime", "bitmap", "geometry", "font-threshold", "local-fonts", "font-source",
  "project", "project-package", "history", "font-validation", "persistence", "project-renderer", "image-tool", "export", "widget-geometry"]) {
  await build({
    entryPoints: [path.join(root, "src", entry + ".ts")], bundle: true,
    outfile: path.join(root, "build", entry + ".mjs"), format: "esm", platform: "node",
  });
}
console.log(`Built offline native verification: ${html.length.toLocaleString()} characters`);
console.log(`Built offline studio: ${studioHtml.length.toLocaleString()} characters`);
const persistenceTest = await build({ entryPoints: [path.join(root, "src", "persistence.ts")],
  bundle: true, format: "iife", globalName: "OledPersistence", write: false, platform: "browser", target: "chrome110" });
const projectTest = await build({ entryPoints: [path.join(root, "src", "project.ts")],
  bundle: true, format: "iife", globalName: "OledProject", write: false, platform: "browser", target: "chrome110" });
await writeFile(path.join(root, "build", "persistence-test.html"), "<!doctype html><meta charset=utf-8><title>Persistence acceptance harness</title><script>" +
  escapeScript(persistenceTest.outputFiles[0].text + "\n" + projectTest.outputFiles[0].text) + "</script>");
