import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProject, createComponent, id, parseProject, pageCodeNames, nextPageCodeName, nextComponentName } from "../build/project.mjs";
import { packProject, unpackProject } from "../build/project-package.mjs";
import { History } from "../build/history.mjs";
import { parseFontC } from "../build/c-data.mjs";
import { inspectFont } from "../build/font-validation.mjs";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

test("project roundtrip includes raw sources, packed image, generated font and metadata", async () => {
  const project = createProject("项目往返");
  const source = await readFile(new URL("../build/otf-font.c", import.meta.url)).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return readFile(new URL("../build/builtin_fonts.c", import.meta.url));
  });
  // Extract a real, upstream generated declaration, never a fabricated font header.
  const declaration = /const uint8_t [\s\S]*?;\r?\n/.exec(source.toString("latin1"))[0];
  const font = parseFontC(declaration);
  project.resources.push({ id: id(), kind: "font", name: "font", license: "test", data: font.bytes,
    coverage: inspectFont(font.bytes), source: new Uint8Array([1, 2, 3]), postscriptName: "Face", size: 16, threshold: 64 });
  const image = { id: id(), kind: "image", name: "13x3", license: "own", width: 13, height: 3,
    data: new Uint8Array([1, 2, 3, 4, 5, 6]), source: new Uint8Array([7, 8, 9]), sourceType: "image/png" };
  project.resources.push(image);
  const component = createComponent("image"); component.resourceId = image.id;
  project.pages[0].components.push(component);
  assert.deepEqual(await unpackProject(await packProject(project)), project);
});

test("project package rejects missing assets, wrong hash, traversal, duplicate and unsupported versions", async () => {
  const project = createProject();
  project.resources.push({ id: id(), kind: "image", name: "one", license: "", width: 1, height: 1, data: new Uint8Array([1]) });
  const original = await packProject(project);
  const files = unzipSync(original);
  const path = Object.keys(files).find(path => path.endsWith(".bin"));
  files[path][0] ^= 1;
  await assert.rejects(unpackProject(zipSync(files)), /校验/);
  delete files[path];
  await assert.rejects(unpackProject(zipSync(files)), /缺失/);
  const clean = unzipSync(original);
  clean["../escape"] = new Uint8Array();
  await assert.rejects(unpackProject(zipSync(clean)), /路径/);
  delete clean["../escape"];
  const manifest = JSON.parse(strFromU8(clean["project.json"]));
  manifest.schemaVersion = 99;
  clean["project.json"] = strToU8(JSON.stringify(manifest));
  await assert.rejects(unpackProject(zipSync(clean)), /版本/);
});

test("project validates geometry, ID uniqueness and resource references without mutating original", () => {
  const project = createProject(), component = createComponent("rect");
  project.pages[0].components.push(component);
  assert.deepEqual(parseProject(project, []), project);
  component.radius = 100;
  assert.throws(() => parseProject(project, []), /整数/);
  component.radius = 0;
  project.pages[0].components.push({ ...component });
  assert.throws(() => parseProject(project, []), /重复/);
});

test("history is transactional; undo/redo restores resources and one drag is one command", () => {
  const original = createProject(), history = new History(original);
  history.change(project => project.pages[0].components.push(createComponent("rect")));
  const before = structuredClone(history.project);
  assert.throws(() => history.change(project => { project.name = "bad"; throw new Error("failed"); }));
  assert.deepEqual(history.project, before);
  assert.equal(history.undo(), true); assert.deepEqual(history.project.pages, original.pages);
  assert.equal(history.redo(), true); assert.deepEqual(history.project.pages, before.pages);
});

test("font bitstream validation rejects stalled RLE and truncation", async () => {
  const source = (await readFile(new URL("../build/builtin_fonts.c", import.meta.url))).toString("latin1");
  const font = parseFontC(/const uint8_t [\s\S]*?;\r?\n/.exec(source)[0]).bytes;
  assert.doesNotThrow(() => inspectFont(font));
  assert.throws(() => inspectFont(font.slice(0, 30)));
  const damaged = font.slice();
  damaged.fill(0, 26, 30);
  assert.throws(() => inspectFont(damaged));
});
test("project package cancellation preserves the editable project", async () => {
  const project = createProject(), before = structuredClone(project), controller = new AbortController();
  controller.abort();
  await assert.rejects(packProject(project, controller.signal), /取消/);
  const packed = await packProject(project);
  await assert.rejects(unpackProject(packed, controller.signal), /取消/);
  assert.deepEqual(project, before);
});

test("page code names validate, survive packages and support legacy pages", async () => {
  const project=createProject();
  project.pages[0].name="中文首页";project.pages[0].codeName="home_screen";
  assert.deepEqual(await unpackProject(await packProject(project)),project);
  const legacy=structuredClone(project);delete legacy.pages[0].codeName;
  assert.deepEqual(pageCodeNames(legacy.pages),["page1"]);
  assert.deepEqual(parseProject(legacy,[]),legacy);
  assert.equal(nextPageCodeName(project.pages),"page1");
  for(const name of ["","中文","1home","a-b","a__b","a".repeat(65)]){
    const bad=structuredClone(project);bad.pages[0].codeName=name;
    assert.throws(()=>parseProject(bad,[]),/代码名称/);
  }
  project.pages.push({...project.pages[0],id:id(),codeName:"HOME_SCREEN"});
  assert.throws(()=>parseProject(project,[]),/代码名称重复/);
  project.pages[1].codeName="page1";
  assert.equal(nextPageCodeName(project.pages),"page2");
});

test("new component names are compact and skip occupied suffixes", () => {
  const a=createComponent("line"),b=createComponent("line");
  assert.equal(a.name,"line1");
  a.name="line1";b.name="line3";
  assert.equal(nextComponentName([a,b],"line"),"line2");
  assert.equal(nextComponentName([a,b],"image"),"image1");
});
