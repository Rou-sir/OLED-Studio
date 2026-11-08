import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";
import { unpackProject } from "../build/project-package.mjs";
import { fontSymbol, resourceNames } from "../build/export.mjs";
import { CPU, avrInstruction, AVRUSART, usart0Config } from "avr8js";
import os from "node:os";

const root = fileURLToPath(new URL("..", import.meta.url));
const generated = path.join(root, "build", "generated");
const reportName = process.env.STUDIO_REPORT ?? "studio";
await mkdir(generated, { recursive: true });
await mkdir(path.join(root, "test-results"), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
const report = { browser: await browser.version(), offline: false, resources: {}, editor: {}, generated: {}, recovery: false };
try {
  const context = await browser.newContext({ offline: true, acceptDownloads: true });
  const page = await context.newPage(), errors = [], requests = [];
  const projectCard = (target, name) => target.locator("#project-list .project-card").filter({ has: target.getByText(name, { exact: true }) });
  const clickSetting = async (target, selector) => {
    if (!(await target.locator("#settings-dialog").evaluate(dialog => dialog.open))) await target.locator("#project-settings").click();
    await target.locator(selector).click();
    if (await target.locator("#settings-dialog").evaluate(dialog => dialog.open)) await target.locator("#close-settings").click();
  };
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on("dialog", dialog => dialog.accept());
  const url = pathToFileURL(path.join(root, "dist", "oled-studio.html")).href;
  await page.goto(url); await page.waitForFunction(() => window.oledStudio?.ready);
  assert.equal(await page.locator("#home-view").isVisible(), true);
  assert.equal(await page.locator("#editor-view").isVisible(), false);
  await page.waitForFunction(() => document.querySelector("#project-count").textContent === "0 个本地项目");
  assert.equal(await page.evaluate(()=>{const event=new KeyboardEvent("keydown",{key:"s",ctrlKey:true,bubbles:true,cancelable:true});return document.dispatchEvent(event);}),false,"Ctrl+S must prevent browser Save As even on empty homepage");
  await page.keyboard.press("Delete");
  assert.equal((await page.evaluate(() => window.oledStudio.project())).pages[0].components.length, 0);
  await page.locator("#new-project").click();
  await page.waitForFunction(() => !document.querySelector("#editor-view").hidden);
  await page.getByLabel("代码名称",{exact:true}).fill("home_screen");
  await page.getByLabel("代码名称",{exact:true}).press("Tab");
  assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].codeName),"home_screen");
  await page.getByLabel("代码名称",{exact:true}).fill("中文");
  await page.getByLabel("代码名称",{exact:true}).press("Tab");
  assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].codeName),"home_screen");
  assert.match(await page.locator("#notice").textContent(),/代码名称/);
  assert.equal(await page.locator("#project-properties").isVisible(), false, "project settings must not crowd the workspace");
  report.offline = true;
  report.capabilities = await page.evaluate(() => ({ secureContext: window.isSecureContext,
    directoryPicker: typeof window.showDirectoryPicker === "function", webLocks: !!navigator.locks, indexedDB: !!window.indexedDB }));
  report.releaseBytes = (await stat(path.join(root,"dist","oled-studio.html"))).size;
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const guideCoordinates = () => page.locator("#selection-guides").evaluate(parent=>
    Object.fromEntries([...parent.children].map(label=>[label.dataset.edge,Number(label.dataset.coordinate)])));
  const firstRect=await page.evaluate(()=>window.oledStudio.project().pages[0].components[0]);
  assert.deepEqual(await guideCoordinates(),{left:firstRect.x,right:firstRect.x+firstRect.width,top:firstRect.y,bottom:firstRect.y+firstRect.height});
  const unguidedPixels=await page.evaluate(()=>window.oledStudio.preview());
  await page.getByLabel("网格",{exact:true}).uncheck();
  assert.ok(await page.locator("#overlay").evaluate(canvas=>{
    const sample=canvas.getContext("2d").getImageData(50,0,1,canvas.height).data;
    return Array.from({length:canvas.height},(_,i)=>sample[i*4+3]).filter(Boolean).length>canvas.height/4;
  }),"reference line spans the artboard rather than only the component");
  await page.locator("#components").getByRole("button",{name:"rect1",exact:true}).click();
  await page.keyboard.press("ArrowRight");
  assert.equal((await guideCoordinates()).left,firstRect.x+1);
  await page.locator("#undo").click();
  await page.getByLabel("纯预览",{exact:true}).check();
  assert.equal(await page.locator("#selection-guides").isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>window.oledStudio.preview()),unguidedPixels,"guides must not affect native pixel output");
  await page.getByLabel("纯预览",{exact:true}).uncheck(); await page.getByLabel("网格",{exact:true}).check();
  await page.screenshot({path:path.join(root,"test-results",reportName+"-guides.png"),fullPage:true});
  report.editor.selectionGuides={fourEdges:true,moveUpdates:true,previewExcludes:true};
  await page.getByRole("button", { name: "ASCII", exact: true }).click();
  assert.equal((await page.evaluate(() => window.oledStudio.project())).pages[0].components.length, 2);
  await page.locator("#undo").click();
  assert.equal((await page.evaluate(() => window.oledStudio.project())).pages[0].components.length, 1);
  await page.locator("#redo").click();
  const initialPixels=await page.evaluate(()=>window.oledStudio.preview());
  const importDownloadEvent=page.waitForEvent("download");
  await page.locator("#save-package").click();
  const importDownload=await importDownloadEvent;
  await importDownload.saveAs(path.join(generated,"import-roundtrip.oled.zip"));
  await page.locator("#project-library").click();
  await page.locator("#new-project").click();
  await page.locator("#project-settings").click();
  await page.locator("#project-properties").getByLabel("名称",{exact:true}).fill("Import Test Temp");
  await page.locator("#project-properties").getByLabel("名称",{exact:true}).press("Tab");
  await page.locator("#close-settings").click();
  await page.locator("#package-file").setInputFiles(path.join(generated,"import-roundtrip.oled.zip"));
  await page.waitForFunction(()=>window.oledStudio.project().pages[0].components.length===2);
  assert.deepEqual(await page.evaluate(()=>window.oledStudio.preview()),initialPixels,"downloaded package must restore actual UI components through the import button");
  report.editor.downloadImportRoundtrip=true;
  await page.locator("#new-page").click(); await page.locator("#copy-page").click();
  assert.equal((await page.evaluate(() => window.oledStudio.project())).pages.length, 3);
  assert.equal(await page.evaluate(()=>new Set(window.oledStudio.project().pages.map(p=>p.codeName)).size),3);
  const beforeDuplicate=await page.getByLabel("代码名称",{exact:true}).inputValue();
  await page.getByLabel("代码名称",{exact:true}).fill("HOME_SCREEN");await page.getByLabel("代码名称",{exact:true}).press("Tab");
  assert.equal(await page.getByLabel("代码名称",{exact:true}).inputValue(),beforeDuplicate);
  await page.locator("#delete-page").click();
  await page.locator("#pages .row button").first().click();
  await page.locator("#components .row button").first().click();
  const beforeMove = await page.evaluate(() => window.oledStudio.project().pages[0].components.at(-1).x);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => window.oledStudio.project().pages[0].components.at(-1).x), beforeMove + 1);
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.oledStudio.project().pages[0].components.at(-1).x), beforeMove);
  report.editor.undoRedo = true;

  await page.locator("#resources").click(); await page.locator("#resource-fonts-tab").click(); await page.locator("#new-font").click();
  assert.deepEqual(await page.locator(".font-step h2").allTextContents(),["资源信息","01 · 选择字体来源","02 · 配置字符集","03 · 调整生成参数","04 · 生成、检查与导出"]);
  await page.getByLabel("资源名称",{exact:true}).focus();
  await page.keyboard.press("Control+s");
  await page.waitForFunction(()=>document.querySelector("#notice").textContent.includes("已执行项目保存"));
  assert.equal(await page.locator("#resource-dialog").evaluate(dialog=>dialog.open),true,"Ctrl+S must work without closing resource configuration");
  await page.locator('#resource-editor input[type="file"]').first().setInputFiles(path.join(root, "build", "test-fonts", "MaShanZheng-Regular.ttf"));
  await page.waitForFunction(() => document.querySelector("#resource-editor").textContent.includes("MaShanZheng-Regular.ttf"));
  assert.equal(await page.getByLabel("资源名称",{exact:true}).inputValue(),"MaShanZheng-Regular");
  await page.getByLabel("资源名称",{exact:true}).fill("status_font");
  await page.getByLabel("提取字符", { exact: true }).fill("中文");
  await page.getByLabel("阈值 0–255", { exact: true }).fill("64");
  await page.getByRole("button", { name: "生成并加入 / 替换字库", exact: true }).click();
  await page.waitForFunction(() => window.oledStudio.project().resources.some(resource => resource.kind === "font"), { timeout: 30000 });
  const fontInfo = await page.evaluate(() => {
    const font = window.oledStudio.project().resources.find(resource => resource.kind === "font");
    return { bytes: font.data.length, source: font.source.length, threshold: font.threshold, coverage: font.coverage };
  });
  assert.equal(fontInfo.threshold, 64); assert.ok(fontInfo.source > 0);
  report.resources.font = fontInfo;
  await page.waitForFunction(()=>document.querySelector(".font-result-status").textContent.includes("生成完成"));
  const downloads=[];
  page.on("download",download=>downloads.push(download));
  await page.getByRole("button",{name:"下载 BDF / C",exact:true}).click();
  await page.waitForTimeout(300);
  const fontDownload=downloads.find(download=>download.suggestedFilename()==="oled_font_status_font.c");
  assert.ok(fontDownload);
  const annotated=await readFile(await fontDownload.path(),"utf8");
  assert.match(annotated,/const uint8_t oled_font_status_font\[/);
  assert.ok(annotated.includes('/* U+4E2D "中" */'));
  assert.ok(annotated.includes('/* U+6587 "文" */'));
  assert.equal(await page.locator(".font-output-preview canvas").count(),1);
  await page.locator(".font-output-preview").scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(root,"test-results",reportName+"-font-config.png"),fullPage:true});
  report.resources.fontLayout = { stages:true, generatedPreview:true, saveShortcutInDialog:true };
  await page.locator("#close-resources").click();
  await page.locator("#components .row button").first().click();
  await page.getByLabel("X",{exact:true}).fill("21");
  await page.keyboard.press("Control+s");
  await page.waitForFunction(()=>document.querySelector("#notice").textContent.includes("已执行项目保存"));
  assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].components.at(-1).x),21,"Ctrl+S commits focused property before saving");
  assert.ok(await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open("oled-studio-v1",2);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    try {return await new Promise((resolve,reject)=>{const req=db.transaction("projects","readonly").objectStore("projects").get(window.oledStudio.project().id);req.onsuccess=()=>resolve(!!req.result?.bytes.length);req.onerror=()=>reject(req.error);});}finally{db.close();}
  }));
  report.editor.ctrlSSavesProject=true;

  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 13; canvas.height = 3;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1, 3); ctx.fillRect(12, 0, 1, 3);
    ctx.fillStyle = "rgb(128,128,128)"; ctx.fillRect(6,0,1,3);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await writeFile(path.join(generated, "source.png"), Buffer.from(png, "base64"));
  await page.locator("#resources").click(); await page.locator("#resource-images-tab").click(); await page.locator("#new-image").click();
  await page.locator('#resource-editor input[type="file"]').first().setInputFiles(path.join(generated, "source.png"));
  await page.waitForFunction(() => document.querySelector("#notice").textContent.includes("原图 13 × 3"));
  await page.getByLabel("输出宽", { exact: true }).fill("13"); await page.getByLabel("输出高", { exact: true }).fill("3");
  const imagePreview = page.locator("#image-conversion-preview");
  await page.getByLabel("亮度阈值 0–255",{exact:true}).fill("200");
  await page.waitForFunction(()=>{const canvas=document.querySelector("#image-conversion-preview");return !canvas.hidden && canvas.width===13 && canvas.height===3;});
  const previewBits = () => imagePreview.evaluate(canvas => {
    const rgba = canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
    return Array.from({length:canvas.width*canvas.height},(_,i)=>rgba[i*4]?1:0);
  });
  const originalBits = await previewBits();
  assert.equal(await imagePreview.evaluate(canvas=>parseInt(canvas.style.width)),78,"default preview is 6x native pixels");
  await page.getByLabel("预览缩放",{exact:true}).fill("12"); await page.getByLabel("预览缩放",{exact:true}).press("Tab");
  assert.equal(await imagePreview.evaluate(canvas=>parseInt(canvas.style.width)),156);
  assert.deepEqual(await previewBits(),originalBits,"preview zoom must not alter image pixels");
  await page.getByLabel("亮度阈值 0–255",{exact:true}).fill("128");
  await page.waitForFunction(()=>{const c=document.querySelector("#image-conversion-preview");return !c.hidden && c.getContext("2d").getImageData(6,0,1,1).data[0]===235;});
  await page.getByLabel("亮度阈值 0–255",{exact:true}).fill("200");
  await page.waitForFunction(()=>{const c=document.querySelector("#image-conversion-preview");return !c.hidden && c.getContext("2d").getImageData(6,0,1,1).data[0]===0;});
  await page.getByLabel("反色",{exact:true}).check();
  await page.waitForFunction(()=>{const c=document.querySelector("#image-conversion-preview");return !c.hidden && c.getContext("2d").getImageData(0,0,1,1).data[0]===0;});
  assert.deepEqual(await previewBits(),originalBits.map(bit=>1-bit));
  assert.equal(await page.evaluate(()=>window.oledStudio.project().resources.filter(r=>r.kind==="image").length),0,"live preview must not auto-replace project resources");
  await page.getByLabel("反色",{exact:true}).uncheck();
  await page.getByLabel("透明背景白色",{exact:true}).check();
  await page.waitForFunction(()=>{const c=document.querySelector("#image-conversion-preview");return !c.hidden && c.getContext("2d").getImageData(5,0,1,1).data[0]===235;});
  assert.deepEqual(await previewBits(),Array.from({length:39},(_,i)=>i%13===6?0:1),"white background fills transparent pixels, not opaque gray pixels below threshold");
  await page.getByLabel("透明背景白色",{exact:true}).uncheck();
  await page.getByLabel("亮度阈值 0–255",{exact:true}).fill("256");
  await page.waitForFunction(()=>document.querySelector(".image-preview-panel [role=status]").textContent.includes("无效"));
  assert.equal(await imagePreview.isVisible(),false,"invalid parameters must not leave a success-shaped stale preview");
  await page.getByRole("button",{name:"保存图片资源",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.oledStudio.project().resources.filter(r=>r.kind==="image").length),0);
  await page.getByLabel("亮度阈值 0–255",{exact:true}).fill("200");
  await page.getByLabel("输出宽",{exact:true}).fill("512");
  await page.waitForFunction(()=>{const c=document.querySelector("#image-conversion-preview");return !c.hidden && c.width===512;});
  assert.ok(await page.locator(".image-preview-viewport").evaluate(view=>view.scrollWidth>view.clientWidth),"large zoomed preview must scroll rather than shrink");
  await page.getByLabel("输出宽",{exact:true}).fill("13");
  await page.getByLabel("裁剪宽",{exact:true}).fill("12");
  await page.waitForFunction(()=>{const c=document.querySelector("#image-conversion-preview");return !c.hidden && c.width===13 && c.getContext("2d").getImageData(12,0,1,1).data[0]===0;});
  await page.getByLabel("裁剪宽",{exact:true}).fill("13");
  await page.getByLabel("Floyd–Steinberg 抖动",{exact:true}).check();
  await page.getByLabel("Floyd–Steinberg 抖动",{exact:true}).uncheck();
  await page.waitForFunction(()=>{const c=document.querySelector("#image-conversion-preview");return !c.hidden && c.width===13;});
  assert.deepEqual(await previewBits(),originalBits);
  await page.screenshot({path:path.join(root,"test-results",reportName+"-image-preview.png"),fullPage:true});
  report.resources.imagePreview={automatic:true,inputRefresh:true,thresholdAndCrop:true,zoomOnly:true,invalidBlocksSave:true,largePreviewScrolls:true};
  await page.getByRole("button", { name: "保存图片资源", exact: true }).click();
  await page.waitForFunction(() => window.oledStudio.project().resources.some(resource => resource.kind === "image"));
  const bitmap = await page.evaluate(() => {
    const resource = window.oledStudio.project().resources.find(resource => resource.kind === "image");
    return { width: resource.width, height: resource.height, data: Array.from(resource.data), source: resource.source.length };
  });
  assert.deepEqual(bitmap.data, [1,16,1,16,1,16]); assert.ok(bitmap.source > 0);
  report.resources.image = bitmap;
  await page.locator("#close-resources").click();
  for (const name of ["线条", "圆", "三角形", "多边形", "中文", "图片"]) await page.getByRole("button", { name, exact: true }).click();
  assert.deepEqual(await page.evaluate(()=>window.oledStudio.project().pages[0].components.map(c=>c.name)),
    ["rect1","ascii1","line1","circle1","triangle1","polygon1","chinese1","image1"]);
  // Configure a real editable project, using resource IDs produced through the actual resource UI.
  await page.evaluate(() => {
    const project = window.oledStudio.project(), components = project.pages[0].components;
    const rect = components.find(component => component.type === "rect"); rect.radius = 4; rect.fill = true;
    const image = components.find(component => component.type === "image"); image.x = 80; image.y = 5; image.transparent = false;
    const chinese = components.find(component => component.type === "chinese"); chinese.x = 100; chinese.y = 30; chinese.align = "center";
    const ascii = components.find(component => component.type === "ascii"); ascii.x = 65; ascii.y = 45; ascii.text = "Hello\\\" OLED"; ascii.fontId = "builtin-6x10";
    const polygon = components.find(component => component.type === "polygon"); polygon.fill = true;
    const circle = components.find(component => component.type === "circle"); circle.x = 55; circle.y = 20;
    window.oledStudio.load(project);
  });
  const base = await page.evaluate(() => {
    const p=window.oledStudio.project();window.controlTestBase=p;
    return p.pages[0].components.map(component=>({id:component.id,name:component.name,type:component.type}));
  });
  for(const descriptor of base){
    await page.evaluate(id=>{
      const p=window.oledStudio.project();for(const c of p.pages[0].components)c.visible=c.id===id;window.oledStudio.load(p);
    },descriptor.id);
    await page.locator("#components").getByRole("button",{name:descriptor.name,exact:true}).click();
    const start=await page.evaluate(id=>window.oledStudio.project().pages[0].components.find(c=>c.id===id),descriptor.id);
    await page.keyboard.press("ArrowRight");
    const moved=await page.evaluate(id=>window.oledStudio.project().pages[0].components.find(c=>c.id===id),descriptor.id);
    assert.equal("x" in moved?moved.x:moved.points[0][0],("x" in start?start.x:start.points[0][0])+1,`integer movement ${descriptor.type}`);
    await page.locator("#undo").click();
    if(["rect","circle","line","triangle","polygon"].includes(descriptor.type)){
      const point=start.points?.[0]??(start.type==="rect"?[start.x+start.width-1,start.y+start.height-1]:[start.x+start.radius,start.y]);
      const box=await page.locator("#overlay").boundingBox();
      await page.mouse.move(box.x+point[0]*5,box.y+point[1]*5);await page.mouse.down();
      await page.mouse.move(box.x+(point[0]+2)*5,box.y+point[1]*5,{steps:8});await page.mouse.up();
      const changed=await page.evaluate(id=>window.oledStudio.project().pages[0].components.find(c=>c.id===id),descriptor.id);
      assert.notDeepEqual(changed,start,`control handle ${descriptor.type}`);
      await page.locator("#undo").click();
      const restored=await page.evaluate(id=>window.oledStudio.project().pages[0].components.find(c=>c.id===id),descriptor.id);
      assert.deepEqual(restored,start,`one drag equals one undo ${descriptor.type}`);
    }
    await page.evaluate(()=>window.oledStudio.load(window.controlTestBase));
  }
  report.editor.allTypesMoved=true;report.editor.controlHandles=true;report.editor.oneDragOneUndo=true;
  await page.locator("#components").getByRole("button",{name:"rect1",exact:true}).click();
  await page.getByLabel("锁定",{exact:true}).check();
  await page.locator("#components").getByRole("button",{name:"rect1",exact:true}).click();
  const lockedX=await page.evaluate(()=>window.oledStudio.project().pages[0].components.find(c=>c.type==="rect").x);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].components.find(c=>c.type==="rect").x),lockedX);
  report.editor.lockRespected=true;
  await page.evaluate(()=>{
    const p=window.oledStudio.project(), chinese=p.pages[0].components.find(c=>c.type==="chinese"),image=p.pages[0].components.find(c=>c.type==="image");
    p.pages[1].components=[{...chinese,id:crypto.randomUUID(),x:20,y:10,align:"left"},{...image,id:crypto.randomUUID(),x:5,y:40}];
    window.oledStudio.load(p);
  });
  await page.locator("#resources").click();
  await page.locator("#resource-images-tab").click();
  const imageResource=await page.evaluate(()=>window.oledStudio.project().resources.find(resource=>resource.kind==="image"));
  await page.locator("#resource-list").getByRole("button",{name:`图片 · ${imageResource.name}`,exact:true}).click();
  const xbmName=resourceNames([imageResource]).get(imageResource.id);
  const xbmDownloadPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"下载 XBM / C 数组",exact:true}).click();
  const xbmDownload=await xbmDownloadPromise;
  assert.equal(xbmDownload.suggestedFilename(),`${xbmName}.xbm`);
  assert.ok((await readFile(await xbmDownload.path(),"utf8")).includes(`static const unsigned char ${xbmName}_bits[]`));
  assert.equal(await page.locator("#resource-list").getByRole("button",{name:/字库 ·/}).count(),0);
  assert.equal(await page.locator("#resource-list").getByText("u8g2_font_5x7_tr",{exact:true}).count(),0);
  await page.locator("#resource-search").fill("no-such-image");
  assert.match(await page.locator("#resource-list").textContent(),/没有匹配/);
  await page.locator("#resource-fonts-tab").click();
  assert.equal(await page.locator("#resource-search").inputValue(),"");
  assert.equal(await page.locator("#resource-list").getByRole("button",{name:/图片 ·/}).count(),0);
  assert.equal(await page.locator("#new-image").isVisible(),false);
  assert.equal(await page.locator("#new-font").isVisible(),true);
  await page.locator("#resource-images-tab").click();
  assert.equal(await page.locator("#resource-search").inputValue(),"no-such-image");
  await page.locator("#resource-search").fill("");
  await page.locator("#resource-fonts-tab").click();
  report.resources.categories={separateLists:true,separateSearch:true,contextualAdd:true};
  await page.screenshot({path:path.join(root,"test-results",reportName+"-resource-categories.png"),fullPage:true});
  await page.locator("#resource-list").getByRole("button",{name:"字库 · status_font",exact:true}).click();
  assert.equal(await page.locator("#resource-editor .resource-reference-list li").count(),2);
  const fontRefs=await page.evaluate(()=>{
    const p=window.oledStudio.project(),font=p.resources.find(r=>r.kind==="font");
    return p.pages.flatMap(page=>page.components.filter(c=>c.fontId===font.id).map(c=>({page:page.name,component:c.name})));
  });
  assert.deepEqual(await page.locator(".resource-reference-list li").evaluateAll(items=>items.map(item=>({
    page:item.querySelector("strong").textContent,component:item.querySelector("span").textContent
  }))),fontRefs);
  assert.equal(await page.locator("#resource-list .resource-reference-list").count(),0);
  assert.equal(await page.locator("#resource-list .resource-card.selected small").count(),3);
  await page.locator("#close-resources").click();
  const referenceTestProject=await page.evaluate(()=>window.oledStudio.project());
  await page.evaluate(()=>{
    const p=window.oledStudio.project(),original=p.pages[1].components.find(c=>c.type==="chinese");
    for(let i=0;i<40;i++)p.pages[1].components.push({...original,id:crypto.randomUUID(),name:"Reference "+i});
    window.oledStudio.load(p);
  });
  await page.locator("#resources").click();
  await page.locator("#resource-list").getByRole("button",{name:"字库 · status_font",exact:true}).click();
  assert.equal(await page.locator(".resource-reference-list li").count(),42);
  assert.ok(await page.locator(".resource-reference-list").evaluate(list=>list.clientHeight<=180&&list.scrollHeight>list.clientHeight));
  await page.screenshot({path:path.join(root,"test-results",reportName+"-resource-references.png"),fullPage:true});
  await page.locator("#close-resources").click();
  await page.evaluate(p=>window.oledStudio.load(p),referenceTestProject);
  await page.locator("#resources").click();
  await page.locator("#resource-list").getByRole("button",{name:"字库 · status_font",exact:true}).click();
  report.resources.referenceDetails={rightEditor:true,cardCompact:true,boundedScroll:true};
  const editorBeforeCategoryCancel=await page.locator("#resource-editor").textContent();
  await page.evaluate(()=>{window.acceptanceConfirm=window.confirm;window.confirm=()=>false;});
  await page.locator("#resource-images-tab").click();
  assert.equal(await page.locator("#resource-fonts-tab").getAttribute("aria-pressed"),"true");
  assert.equal(await page.locator("#resource-editor").textContent(),editorBeforeCategoryCancel);
  await page.evaluate(()=>{window.confirm=window.acceptanceConfirm;delete window.acceptanceConfirm;});
  report.resources.categories.cancelPreservesEditor=true;
  await page.getByRole("button",{name:"删除资源",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector("#notice").textContent.includes("仍被"));
  assert.equal(await page.evaluate(()=>window.oledStudio.project().resources.length),2);
  await page.getByLabel("资源名称",{exact:true}).fill("共享字库");
  await page.getByRole("button",{name:"保存名称和许可",exact:true}).click();
  await page.waitForFunction(()=>window.oledStudio.project().resources.some(r=>r.name==="共享字库"));
  await page.locator("#close-resources").click();
  report.resources.sharedReferencesProtected=true;
  assert.match(await page.locator("#diagnostics").textContent(), /裁剪警告/);
  const originalColorProject=await page.evaluate(()=>JSON.stringify(window.oledStudio.project()));
  const originalColorBits=await page.evaluate(()=>window.oledStudio.preview());
  await page.locator("#preview-settings summary").click();
  await page.locator("#preview-color").evaluate(input=>{input.value="#37b4ee";input.dispatchEvent(new Event("input",{bubbles:true}));});
  const checkPreviewColor=async()=>assert.deepEqual(await page.locator("#pixels").evaluate(canvas=>{
    const data=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
    const colors=new Set();for(let i=0;i<data.length;i+=4)colors.add([...data.slice(i,i+4)].join(","));
    return [...colors].sort();
  }),["0,0,0,255","55,180,238,255"]);
  await checkPreviewColor();
  assert.equal(await page.evaluate(()=>JSON.stringify(window.oledStudio.project())),originalColorProject);
  assert.deepEqual(await page.evaluate(()=>window.oledStudio.preview()),originalColorBits);
  await page.locator("#preview-mode").check();await checkPreviewColor();
  await page.locator("#preview-mode").uncheck();
  await page.locator("#project-settings").click();
  const pngEvent=page.waitForEvent("download");await page.locator("#export-png").click();
  const pngDownload=await pngEvent;
  const pngPath=path.join(generated,"preview-color.png");await pngDownload.saveAs(pngPath);
  const pngBase64=(await readFile(pngPath)).toString("base64");
  const pngColors=await page.evaluate(async base64=>{
    const image=await createImageBitmap(await (await fetch("data:image/png;base64,"+base64)).blob());
    const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);image.close();
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,colors=new Set();
    for(let i=0;i<data.length;i+=4)colors.add([...data.slice(i,i+4)].join(","));
    return [...colors].sort();
  },pngBase64);
  assert.deepEqual(pngColors,["0,0,0,255","235,235,235,255"]);
  await page.locator("#close-settings").click();
  await page.locator("#reset-preview-color").click();
  assert.equal(await page.locator("#preview-color").inputValue(),"#ebebeb");
  await page.locator("#preview-settings summary").click();
  report.editor.previewColor={live:true,purePreview:true,projectUnchanged:true,pixelsUnchanged:true,pngUnchanged:true,reset:true};
  const panelWidth = async side => (await page.locator(`.${side}-panel`).boundingBox()).width;
  for(const [side,delta] of [["left",70],["right",-80]]){
    const before=await panelWidth(side),handle=await page.locator(`#${side}-resizer`).boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+100);await page.mouse.down();
    await page.mouse.move(handle.x+handle.width/2+delta,handle.y+100,{steps:8});await page.mouse.up();
    assert.equal(await panelWidth(side),before+Math.abs(delta));
    assert.equal(await page.locator("body").evaluate(body=>body.classList.contains("resizing-panels")),false);
  }
  const beforeKeyboard=await panelWidth("right");
  await page.locator("#right-resizer").focus();await page.keyboard.press("ArrowLeft");
  assert.equal(await panelWidth("right"),beforeKeyboard+10);
  const oldPanel=await panelWidth("left"),cancelHandle=await page.locator("#left-resizer").boundingBox();
  await page.mouse.move(cancelHandle.x+3,cancelHandle.y+100);await page.mouse.down();
  await page.locator("#left-resizer").dispatchEvent("pointercancel");
  await page.mouse.up();
  assert.equal(await panelWidth("left"),oldPanel);
  await page.locator("#left-resizer").dblclick();
  assert.equal(await panelWidth("left"),224);assert.equal(await panelWidth("right"),264);
  const sectionStyles=await page.evaluate(()=>({
    pages:getComputedStyle(document.querySelector("#pages")).overflowY,
    components:getComputedStyle(document.querySelector("#components")).overflowY,
    scrollbar:getComputedStyle(document.querySelector(".right-panel")).scrollbarWidth,
    pageBorder:getComputedStyle(document.querySelector(".page-section")).borderTopColor,
    layerBorder:getComputedStyle(document.querySelector(".layer-section")).borderTopColor
  }));
  assert.equal(sectionStyles.pages,"auto");assert.equal(sectionStyles.components,"auto");
  assert.equal(sectionStyles.scrollbar,"thin");assert.notEqual(sectionStyles.pageBorder,sectionStyles.layerBorder);
  report.editor.resizablePanels={bothDragged:true,keyboard:true,cancelCleanup:true,reset:true,independentLists:true,thinScrollbars:true};
  const full = await page.evaluate(() => window.oledStudio.preview(false)), paged = await page.evaluate(() => window.oledStudio.preview(true));
  assert.deepEqual(full, paged);
  const downloadEvent = page.waitForEvent("download"); await page.locator("#export-code").click();
  assert.deepEqual(await page.locator("#export-target option").allTextContents(),["Arduino","ESP-IDF","STM32 HAL"]);
  await page.screenshot({path:path.join(root,"test-results",reportName+"-export.png"),fullPage:true});
  await page.locator("#export-target").selectOption("arduino"); await page.locator("#confirm-export").click();
  const archive = await downloadEvent; await archive.saveAs(path.join(generated, "oled-ui.zip"));
  const files = unzipSync(new Uint8Array(await readFile(path.join(generated, "oled-ui.zip"))));
  assert.deepEqual(Object.keys(files).sort(),["oled_ui.cpp","oled_ui.h","oled_resources.c","oled_resources.h","oled_polygon.h","oled_ui_arduino.hpp"].sort());
  const decode=text=>new TextDecoder().decode(text);
  assert.equal(files["oled_ui.c"],undefined); assert.ok(files["oled_ui.cpp"]);
  assert.match(decode(files["oled_ui.cpp"]),/display\.drawXBMP\(/);
  assert.match(decode(files["oled_ui.cpp"]),/int oled_ui_page_home_screen\(/);
  assert.match(decode(files["oled_ui.h"]),/OLED_PAGE_HOME_SCREEN = 0/);
  assert.match(decode(files["oled_ui.cpp"]),/display\.drawUTF8\(/);
  assert.match(decode(files["oled_ui.cpp"]),/display\.drawUTF8\(\d+, \d+, "中文"\)/);
  const exportedFontSymbol=fontSymbol(await page.evaluate(()=>window.oledStudio.project().resources.find(resource=>resource.kind==="font").name));
  assert.ok(decode(files["oled_ui.cpp"]).includes(`display.setFont(${exportedFontSymbol})`));
  assert.ok(decode(files["oled_resources.c"]).includes('/* U+4E2D "中" */'));
  assert.ok(decode(files["oled_resources.c"]).includes('/* U+6587 "文" */'));
  assert.doesNotMatch(decode(files["oled_ui.cpp"]),/u8g2_Draw|getU8g2/);
  assert.match(decode(files["oled_resources.c"]),/U8X8_PROGMEM/);
  const exportedImage=await page.evaluate(()=>window.oledStudio.project().resources.find(resource=>resource.kind==="image"));
  const exportedImageSymbol=resourceNames([exportedImage]).get(exportedImage.id);
  assert.ok(decode(files["oled_ui.cpp"]).includes(`, ${exportedImageSymbol});`));
  assert.ok(decode(files["oled_resources.h"]).includes(`extern const uint8_t ${exportedImageSymbol}[`));
  let cFiles;
  for (const target of ["esp-idf","stm32-hal"]) {
    await page.locator("#export-code").click(); await page.locator("#export-target").selectOption(target);
    const platformDownload = page.waitForEvent("download"); await page.locator("#confirm-export").click();
    const download = await platformDownload;
    assert.equal(download.suggestedFilename(),`oled-ui-${target}.zip`);
    await download.saveAs(path.join(generated,`oled-ui-${target}.zip`));
    const targetFiles = unzipSync(new Uint8Array(await readFile(path.join(generated,`oled-ui-${target}.zip`))));
    assert.deepEqual(Object.keys(targetFiles).sort(),["oled_ui.c","oled_ui.h","oled_resources.c","oled_resources.h","oled_polygon.h"].sort());
    assert.equal(targetFiles["oled_ui.cpp"],undefined);
    assert.match(decode(targetFiles["oled_ui.c"]),/u8g2_DrawXBM\(ctx,/);
    assert.match(decode(targetFiles["oled_ui.c"]),/u8g2_DrawUTF8\(ctx, \d+, \d+, "中文"\)/);
    assert.ok(decode(targetFiles["oled_ui.c"]).includes(`, ${exportedImageSymbol});`));
    assert.ok(decode(targetFiles["oled_ui.c"]).includes(`u8g2_SetFont(ctx, ${exportedFontSymbol})`));
    assert.doesNotMatch(decode(targetFiles["oled_ui.c"]),/u8g2_DrawXBMP|display\./);
    assert.doesNotMatch(decode(targetFiles["oled_resources.c"]),/U8X8_PROGMEM/);
    for (const name of ["oled_resources.h","oled_polygon.h"])
      assert.deepEqual(targetFiles[name],files[name],`same page/resource semantics for ${target}: ${name}`);
    if(cFiles)for(const name of ["oled_ui.c","oled_ui.h","oled_resources.c"])
      assert.deepEqual(targetFiles[name],cFiles[name],`same C API for ${target}: ${name}`);
    cFiles=targetFiles;
    const dir=path.join(generated,target);await mkdir(dir,{recursive:true});
    for(const [name,data] of Object.entries(targetFiles))await writeFile(path.join(dir,name),data);
  }
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(generated, name), data);
  if (process.env.STUDIO_SKIP_MCU_BUILD === "1") {
    report.generated = {platformPackages:["arduino","esp-idf","stm32-hal"],sourceOnly:true,mcuCompilationSkipped:true,hardwareVerified:false};
  } else {
  execFileSync("python", [path.join(root, "scripts", "build_generated.py")], { cwd: root, stdio: "pipe" });
  for (const mode of [0, 1]) {
    execFileSync(path.join(generated, "reference.exe"), [path.join(generated, `page-${mode}.raw`), "0", String(mode)]);
    assert.deepEqual(Array.from(await readFile(path.join(generated, `page-${mode}.raw`))), full, `actual generated C full/page ${mode}`);
  }
  await page.locator("#pages .row").nth(1).getByRole("button").first().click();
  const secondPage=await page.evaluate(()=>window.oledStudio.preview());
  for(const mode of [0,1]){
    execFileSync(path.join(generated,"reference.exe"),[path.join(generated,"second-page.raw"),"1",String(mode)]);
    assert.deepEqual(Array.from(await readFile(path.join(generated,"second-page.raw"))),secondPage);
  }
  await page.locator("#pages .row").first().getByRole("button").first().click();
  const firmware = await readFile(path.join(generated, "avr.bin")), program = new Uint16Array(16384);
  new Uint8Array(program.buffer).set(firmware);
  const cpu = new CPU(program, 2048), uart = new AVRUSART(cpu, usart0Config, 16000000), transmitted = [];
  uart.onByteTransmit = byte => transmitted.push(byte);
  while (transmitted.length < 1026 && cpu.cycles < 16000000 * 10) { avrInstruction(cpu); cpu.tick(); }
  assert.equal(transmitted.length, 1026); assert.deepEqual(transmitted.slice(0,2), [0x4f,0x4c]);
  const avrPixels = [];
  for(let y=0;y<64;y++)for(let x=0;x<128;x++)avrPixels.push((transmitted[2+(y>>3)*128+x]>>(y&7))&1);
  assert.deepEqual(avrPixels,full, "actual project-generated AVR flash resource reads");
  report.generated = { host: true, cortexM3: true, arduinoNativeCpp: true, avrSimulated: true,
    avrFirmwareBytes: firmware.length, fullPage: true, differentPixels: 0, components: 8, platformPackages:["arduino","esp-idf","stm32-hal"], hardwareVerified: false };
  }
  const packageEvent = page.waitForEvent("download"); await page.locator("#save-package").click();
  const packageDownload = await packageEvent; await packageDownload.saveAs(path.join(generated, "project.oled.zip"));
  const recovered = await unpackProject(new Uint8Array(await readFile(path.join(generated, "project.oled.zip"))));
  assert.equal(recovered.resources.length, 2); assert.ok(recovered.resources.every(resource => resource.source?.length));
  await page.evaluate(() => window.oledStudio.flush()); await page.reload(); await page.waitForFunction(() => window.oledStudio?.ready);
  assert.equal(await page.locator("#home-view").isVisible(), true, "reload must start in project homepage rather than restored editor");
  const recoveredCard = projectCard(page, "新项目");
  await recoveredCard.locator("canvas").waitFor();
  const cardPixels = await recoveredCard.locator("canvas").evaluate(canvas => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    return Array.from({ length: canvas.width * canvas.height }, (_, index) => data[index * 4] ? 1 : 0);
  });
  assert.deepEqual(cardPixels, full, "homepage thumbnail must match the default page's actual U8g2 pixels");
  await page.screenshot({ path: path.join(root, "test-results", reportName + "-home.png"), fullPage: true });
  await recoveredCard.getByRole("button", { name: "重命名", exact: true }).click();
  await page.locator("#rename-name").fill("首页预览测试");
  await page.locator("#rename-form").getByRole("button", { name: "保存名称", exact: true }).click();
  await projectCard(page, "首页预览测试").locator("canvas").waitFor();
  await projectCard(page, "首页预览测试").getByRole("button", { name: "重命名", exact: true }).click();
  await page.locator("#rename-name").fill("新项目");
  await page.locator("#rename-form").getByRole("button", { name: "保存名称", exact: true }).click();
  await projectCard(page, "新项目").getByRole("button", { name: "打开项目 新项目", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.oledStudio.preview()), full);
  report.recovery = true;
  const originalId=await page.evaluate(()=>window.oledStudio.project().id);
  await page.locator("#project-library").click();
  await projectCard(page,"新项目").getByRole("button",{name:"复制项目",exact:true}).click();
  await page.waitForFunction(id=>window.oledStudio.project().id!==id,originalId);
  const copiedId=await page.evaluate(()=>window.oledStudio.project().id);
  await page.locator("#project-library").click();
  await projectCard(page,"新项目").getByRole("button",{name:"打开项目 新项目",exact:true}).click();
  await page.waitForFunction(id=>window.oledStudio.project().id===id,originalId);
  await page.locator("#project-library").click();
  await projectCard(page,"新项目 副本").getByRole("button",{name:"删除缓存条目",exact:true}).click();
  await page.waitForFunction(()=>![...document.querySelectorAll("#project-list strong")].some(node=>node.textContent==="新项目 副本"));
  await projectCard(page,"新项目").getByRole("button",{name:"打开项目 新项目",exact:true}).click();
  report.editor.homepage = { startup: true, defaultPagePixels: true, rename: true, keyboardIsolated: true, separateSettings: true };
  assert.notEqual(originalId,copiedId);report.editor.projectCopyOpenDelete=true;
  await page.evaluate(() => {
    window.savedAcceptanceProject = window.oledStudio.project();
    const p = window.oledStudio.project(), model = p.pages[0].components.find(component => component.type === "rect");
    p.pages[0].components = Array.from({length:200}, (_,i) => ({...model,id:crypto.randomUUID(),locked:false,x:(i%25)*5,y:Math.floor(i/25)*7,width:4,height:4,radius:0}));
    p.pages[0].components.at(-1).x=20; p.pages[0].components.at(-1).y=20;
    while(p.pages.length<10)p.pages.push({id:crypto.randomUUID(),name:"Perf "+p.pages.length,background:0,components:[]});
    const image = p.resources.find(resource=>resource.kind==="image");
    for(let i=0;i<49;i++)p.resources.push({...image,id:crypto.randomUUID(),name:"Perf image "+i});
    window.oledStudio.load(p);
    window.benchmarkFrames=[];window.recordingFrames=true;let previous=performance.now();
    const frame=now=>{if(!window.recordingFrames)return;window.benchmarkFrames.push(now-previous);previous=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const artboard = await page.locator("#overlay").boundingBox();
  const listScroll = await page.evaluate(()=>{
    const pages=document.querySelector("#pages"),components=document.querySelector("#components");
    const before=components.scrollTop;
    pages.scrollTop=pages.scrollHeight;
    return {pagesOverflow:pages.scrollHeight>pages.clientHeight,pagesMoved:pages.scrollTop>0,
      componentsOverflow:components.scrollHeight>components.clientHeight,componentsUnchanged:components.scrollTop===before};
  });
  assert.deepEqual(listScroll,{pagesOverflow:true,pagesMoved:true,componentsOverflow:true,componentsUnchanged:true});
  await page.screenshot({path:path.join(root,"test-results",reportName+"-panels.png"),fullPage:true});
  await page.mouse.move(artboard.x+21*5,artboard.y+21*5);await page.mouse.down();
  await page.mouse.move(artboard.x+31*5,artboard.y+23*5,{steps:60});await page.mouse.up();
  const frames=await page.evaluate(()=>{window.recordingFrames=false;return window.benchmarkFrames.slice(1);});
  assert.ok(frames.length>10);
  const p95=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length*.95)];
  const propertyTimes=await page.evaluate(async()=>{
    const samples=[];
    for(let i=0;i<20;i++){
      const field=[...document.querySelectorAll("#properties label")].find(label=>label.querySelector("span")?.textContent==="X")?.querySelector("input");
      if(!field)throw new Error("Select a component to measure property preview");
      const start=performance.now();field.value=String(30+(i%2));field.dispatchEvent(new Event("change",{bubbles:true}));
      await new Promise(resolve=>requestAnimationFrame(()=>{samples.push(performance.now()-start);resolve();}));
    }
    return samples;
  });
  report.performance={cpu:os.cpus()[0].model,pages:10,currentComponents:200,imageResources:50,
    composition:"200 visible filled 4x4 rectangles; 50 project image resources",
    dragFrameP95Ms:p95(frames),propertyPreviewP95Ms:p95(propertyTimes),frameThresholdMs:33,propertyThresholdMs:100};
  assert.ok(report.performance.dragFrameP95Ms<=33,`drag frame p95 ${report.performance.dragFrameP95Ms}`);
  assert.ok(report.performance.propertyPreviewP95Ms<=100,`property preview p95 ${report.performance.propertyPreviewP95Ms}`);
  const marqueeBox=await page.locator("#overlay").boundingBox();
  await page.mouse.move(marqueeBox.x+1,marqueeBox.y+63*5);await page.mouse.down();
  await page.mouse.move(marqueeBox.x+127*5,marqueeBox.y+1,{steps:10});await page.mouse.up();
  assert.match(await page.locator("#properties").textContent(),/已选择 200 个组件/);
  const combinedBounds = await page.evaluate(()=>{
    const cs=window.oledStudio.project().pages[0].components;
    return {left:Math.min(...cs.map(c=>c.x)),right:Math.max(...cs.map(c=>c.x+c.width)),
      top:Math.min(...cs.map(c=>c.y)),bottom:Math.max(...cs.map(c=>c.y+c.height))};
  });
  assert.deepEqual(await guideCoordinates(),combinedBounds,"four guides use the aggregate bounds of a multiple selection");
  report.editor.selectionGuides.multiSelection=true;
  const groupX=await page.evaluate(()=>window.oledStudio.project().pages[0].components[0].x);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].components[0].x),groupX+1);
  await page.locator("#undo").click();
  await page.locator("#align-left").click();
  assert.equal(await page.evaluate(()=>new Set(window.oledStudio.project().pages[0].components.map(c=>c.x)).size),1);
  await page.locator("#undo").click();
  await page.getByText("更多对齐",{exact:true}).click();
  await page.locator("#alignment-tools").getByRole("button", { name: "右对齐", exact: true }).click();
  assert.equal(await page.evaluate(()=>new Set(window.oledStudio.project().pages[0].components.map(c=>c.x+c.width)).size),1);
  assert.equal(await page.locator(".toolbar-menu").first().evaluate(menu=>menu.open),false);
  await page.locator("#undo").click();
  report.editor.marqueeGroupMoveAlign=true;
  const system = await browser.newBrowserCDPSession();
  const processInfo = await system.send("SystemInfo.getProcessInfo");
  const pids = processInfo.processInfo.map(process => Number(process.id)).filter(pid=>Number.isInteger(pid)&&pid>0);
  const memory = execFileSync("powershell.exe",["-NoProfile","-Command",
    `Get-Process -Id ${pids.join(",")} -ErrorAction Stop | Select-Object Id,WorkingSet64,PeakWorkingSet64 | ConvertTo-Json -Compress`],{encoding:"utf8"});
  report.performance.memory = { processes:JSON.parse(memory),
    note:"OS working set and lifetime per-process high-water marks for still-running isolated test-browser processes; not a synchronized total peak." };
  await page.evaluate(()=>window.oledStudio.load(window.savedAcceptanceProject));
  await clickSetting(page,"#save-now");await page.evaluate(()=>window.oledStudio.flush());
  const layoutSizes = [];
  for (const width of [1440, 1280, 1024, 760]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const editor = document.querySelector("#editor-view").getBoundingClientRect();
      const main = document.querySelector("main").getBoundingClientRect();
      const canvas = document.querySelector(".viewport").getBoundingClientRect();
      return { width: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth,
        editorWidth: editor.width, canvasWidth: canvas.width, canvasHeight: canvas.height, mainWidth: main.width };
    });
    assert.equal(layout.pageOverflow, false, `outer page must not overflow at ${width}px; narrow workspace may scroll internally`);
    assert.ok(layout.canvasWidth >= 280 && layout.canvasHeight >= 350, `usable canvas at ${width}px`);
    layoutSizes.push(layout);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  report.editor.layout = layoutSizes;
  const persistencePage = await context.newPage();
  await persistencePage.route("https://oled-test.invalid/", async route => route.fulfill({
    contentType: "text/html", body: await readFile(path.join(root, "build", "persistence-test.html"), "utf8"),
  }));
  await persistencePage.goto("https://oled-test.invalid/");
  report.persistence = await persistencePage.evaluate(async () => {
    const failures = [], states = [];
    const directory = await navigator.storage.getDirectory();
    window.showDirectoryPicker = async () => directory;
    const store = new OledPersistence.Persistence(state => states.push({ ...state }), error => failures.push(String(error)));
    const model = OledProject.createProject("native-directory-test");
    await store.chooseDirectory(); store.save(model); await store.flush();
    const file = await directory.getFileHandle("project.oled.zip"), saved = await (await file.getFile()).arrayBuffer();
    if (!saved.byteLength || !states.at(-1).disk.includes("磁盘已保存")) throw new Error("Native directory save did not close successfully");
    model.name = "second"; store.save(model); model.name = "latest"; store.save(model); await store.flush();
    const recovered = new OledPersistence.Persistence(() => {}, error => failures.push(String(error)));
    const cached = await recovered.recover();
    if (cached.name !== "latest") throw new Error("Queued save/cache recovery lost the latest revision");
    const writer = await file.createWritable(); await writer.write(new Uint8Array([1,2,3])); await writer.close();
    model.name = "conflict-edit"; store.save(model); await store.flush();
    const external = new Uint8Array(await (await file.getFile()).arrayBuffer());
    if (external.join(",") !== "1,2,3" || !failures.some(message => message.includes("外部修改"))) throw new Error("External conflict was overwritten");
    const recoveryAfterConflict = new OledPersistence.Persistence(() => {}, error => failures.push(String(error)));
    if ((await recoveryAfterConflict.recover()).name !== "conflict-edit") throw new Error("Conflict discarded cache");
    const catalog = await store.listProjects();
    if (!catalog.some(project => project.id === model.id)) throw new Error("Project catalog missing");
    const beforeReadState = JSON.stringify(store.state), beforeReadEvents = states.length;
    const readOnlyProject = await store.readProject(model.id);
    if (readOnlyProject.id !== model.id || !store.hasDirectory || JSON.stringify(store.state) !== beforeReadState || states.length !== beforeReadEvents)
      throw new Error("Thumbnail cache read changed the active project directory or save state");
    await store.deleteProject(model.id);
    return { backend: "native browser origin-private directory at locally intercepted HTTPS test origin (not file:// OS picker)", closedWrite: true, serialLatest: true,
      externalConflictPreserved: true, conflictCacheRecovered: true, catalog: true, readOnlyThumbnails: true, systemPickerVerified: false };
  });
  await persistencePage.close();
  const importPage = await context.newPage(), importDialogs = [];
  importPage.on("dialog", async dialog => { importDialogs.push(dialog.message()); await dialog.accept(); });
  await importPage.route("https://oled-import-test.invalid/", async route => route.fulfill({
    contentType: "text/html", body: await readFile(path.join(root, "dist", "oled-studio.html"), "utf8"),
  }));
  await importPage.goto("https://oled-import-test.invalid/");
  await importPage.waitForFunction(() => window.oledStudio?.ready);
  await importPage.evaluate(async () => {
    window.testDirectory = await navigator.storage.getDirectory();
    window.showDirectoryPicker = async () => window.testDirectory;
  });
  await importPage.locator('[data-action="open-directory"]').click();
  await importPage.waitForFunction(() => !document.querySelector("#editor-view").hidden);
  await importPage.getByRole("button", { name: "矩形", exact: true }).click();
  await importPage.getByLabel("X", { exact: true }).fill("20");
  await importPage.getByLabel("X", { exact: true }).press("Tab");
  await clickSetting(importPage,"#save-now"); await importPage.evaluate(() => window.oledStudio.flush());
  const directoryDownloadEvent = importPage.waitForEvent("download");
  await importPage.locator("#save-package").click();
  await (await directoryDownloadEvent).saveAs(path.join(generated, "directory-import.oled.zip"));
  await importPage.getByLabel("X", { exact: true }).fill("40");
  await importPage.keyboard.press("Control+s");
  await importPage.waitForFunction(()=>document.querySelector("#notice").textContent.includes("已执行项目保存"));
  await importPage.evaluate(() => window.oledStudio.flush());
  await importPage.locator("#package-file").setInputFiles(path.join(generated, "directory-import.oled.zip"));
  await importPage.waitForFunction(() => window.oledStudio.project().pages[0].components[0]?.x === 20);
  await importPage.evaluate(() => window.oledStudio.flush());
  assert.match(importDialogs.at(-1), /包内 1 个页面、1 个组件/);
  assert.match(importDialogs.at(-1), /该包比当前项目更旧/);
  assert.ok(!importDialogs.at(-1).includes("\\n"), "import warning must display real newlines");
  const readImportDisk = () => importPage.evaluate(async () => Array.from(new Uint8Array(await
    (await (await window.testDirectory.getFileHandle("project.oled.zip")).getFile()).arrayBuffer())));
  const retainedDisk = await readImportDisk(), restoredDiskProject = await unpackProject(new Uint8Array(retainedDisk));
  assert.equal(restoredDiskProject.pages[0].components[0].x, 20, "same-project import must retain directory binding and persist the restored snapshot");
  await importPage.locator("#package-file").setInputFiles(path.join(generated, "import-roundtrip.oled.zip"));
  await importPage.waitForFunction(() => window.oledStudio.project().pages[0].components.length === 2);
  await clickSetting(importPage,"#save-now"); await importPage.evaluate(() => window.oledStudio.flush());
  assert.deepEqual(await readImportDisk(), retainedDisk, "different-project import must not overwrite the previous project's directory");
  assert.ok(!importDialogs.at(-1).includes("该包比当前项目更旧"), "unrelated project timestamps are not snapshot versions");
  report.editor.directoryImport = { sameProjectRetainsBinding: true, restoredRectangleX: 20, differentProjectDetaches: true,
    backend: "native origin-private directory injected into picker at locally intercepted HTTPS test origin; not system picker authorization" };
  await importPage.close();
  const quotaPage=await context.newPage();
  await quotaPage.route("https://oled-quota-test.invalid/",async route=>route.fulfill({
    contentType:"text/html",body:await readFile(path.join(root,"build","persistence-test.html"),"utf8"),
  }));
  await quotaPage.goto("https://oled-quota-test.invalid/");
  const quotaCdp=await context.newCDPSession(quotaPage);
  await quotaCdp.send("Storage.overrideQuotaForOrigin",{origin:"https://oled-quota-test.invalid",quotaSize:1});
  report.quotaFailure=await quotaPage.evaluate(async()=>{
    const errors=[],store=new OledPersistence.Persistence(()=>{},error=>errors.push(String(error)));
    const project=OledProject.createProject("quota-project");store.save(project);
    let rejected=false;try{await store.flush();}catch{rejected=true;}
    if(!rejected||!errors.length||!store.state.cache.includes("失败")||project.name!=="quota-project")throw new Error("Native quota failure was not surfaced or lost the editable model");
    return{backend:"native IndexedDB quota via CDP override",explicitFailure:true,modelPreserved:true};
  });
  await quotaPage.close();
  await page.screenshot({ path: path.join(root, "test-results", reportName + ".png"), fullPage: true });
  await page.locator("#images-tab").click();
  assert.equal(await page.locator("#layout-panel").isVisible(),false);
  assert.equal(await page.locator("#sidebar-images .sidebar-image").count(),1);
  const countBeforeImage = await page.evaluate(()=>window.oledStudio.project().pages[0].components.length);
  await page.locator("#sidebar-images").getByRole("button",{name:"添加图片 source.png",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].components.length),countBeforeImage+1);
  await page.locator("#sidebar-add-image").click();
  await page.getByRole("button",{name:"手工绘制模式",exact:true}).click();
  await page.getByLabel("资源名称",{exact:true}).fill("Drawn Test");
  assert.equal(await page.getByLabel("绘制宽",{exact:true}).count(),0);
  await page.getByRole("button",{name:"保存绘制图片",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.oledStudio.project().resources.some(r=>r.name==="Drawn Test")),false,"empty drawing cannot be saved");
  const draw = page.locator("#drawing-canvas");
  const revealDrawing = async () => {
    await page.locator("#resource-dialog").evaluate(dialog => {
      const canvas=dialog.querySelector("#drawing-canvas");
      canvas.parentElement.scrollLeft=0;canvas.parentElement.scrollTop=0;
      dialog.scrollTop=canvas.parentElement.offsetTop-100;
    });
  };
  await revealDrawing();
  const drawBox = await draw.boundingBox();
  await page.mouse.move(drawBox.x+63,drawBox.y+63); await page.mouse.down();
  await page.mouse.move(drawBox.x+135,drawBox.y+63,{steps:4}); await page.mouse.up();
  const drawingBits = () => draw.evaluate(canvas=>{
    const data=canvas.getContext("2d").getImageData(0,0,32,32).data;
    return Array.from({length:1024},(_,i)=>data[i*4]?1:0);
  });
  assert.deepEqual(await drawingBits(),Array.from({length:1024},(_,i)=>Math.floor(i/32)===10&&i%32>=10&&i%32<=22?1:0),"fast stroke interpolates every crossed pixel");
  assert.match(await page.locator("#drawing-status").textContent(),/实际图片 13 × 1/);
  await page.getByRole("button",{name:"绘制撤销",exact:true}).click(); assert.ok((await drawingBits()).every(bit=>bit===0));
  await page.getByRole("button",{name:"绘制重做",exact:true}).click(); assert.equal((await drawingBits()).filter(Boolean).length,13);
  await revealDrawing(); const eraseBox=await draw.boundingBox();
  await page.mouse.click(eraseBox.x+99,eraseBox.y+63,{button:"right"});
  assert.equal((await drawingBits())[10*32+16],0);
  assert.equal(await draw.evaluate(canvas=>{const event=new MouseEvent("contextmenu",{cancelable:true,bubbles:true});return canvas.dispatchEvent(event);}),false);
  await page.mouse.click(eraseBox.x+63,eraseBox.y+63,{button:"right"});
  assert.match(await page.locator("#drawing-status").textContent(),/实际图片 12 × 1/);
  await page.getByRole("button",{name:"绘制撤销",exact:true}).click();
  await page.getByRole("button",{name:"清空绘制",exact:true}).click(); assert.ok((await drawingBits()).every(bit=>bit===0));
  await page.getByRole("button",{name:"绘制撤销",exact:true}).click(); assert.equal((await drawingBits()).filter(Boolean).length,12);
  await page.getByRole("button",{name:"保存绘制图片",exact:true}).click();
  const drawn = await page.evaluate(()=>window.oledStudio.project().resources.find(r=>r.name==="Drawn Test"));
  assert.equal(drawn.width,13); assert.equal(drawn.height,1);
  assert.deepEqual(Array.from(drawn.data),[191,31]);
  await page.locator("#close-resources").click();
  await page.getByLabel("搜索项目图片",{exact:true}).fill("Drawn");
  assert.equal(await page.locator("#sidebar-images .sidebar-image").count(),1);
  await page.locator("#sidebar-images").getByRole("button",{name:"添加图片 Drawn Test",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].components.at(-1).resourceId),drawn.id);
  await page.locator("#sidebar-images").getByRole("button",{name:"编辑资源",exact:true}).click();
  await page.getByRole("button",{name:"手工绘制模式",exact:true}).click();
  assert.deepEqual(await drawingBits(),Array.from({length:1024},(_,i)=>i<13&&i!==6?1:0),"existing cropped drawing reloads at origin without source image");
  await page.getByLabel("绘制缩放",{exact:true}).fill("20"); await page.getByLabel("绘制缩放",{exact:true}).press("Tab");
  assert.equal(await draw.evaluate(canvas=>canvas.style.width),"10240px");
  assert.equal((await drawingBits()).filter(Boolean).length,12);
  await revealDrawing();
  await page.screenshot({path:path.join(root,"test-results",reportName+"-drawing.png"),fullPage:true});
  await page.locator("#close-resources").click(); await page.locator("#layout-tab").click();
  assert.equal(await page.locator("#layout-panel").isVisible(),true);
  const drawnPackageEvent=page.waitForEvent("download"); await page.locator("#save-package").click();
  await (await drawnPackageEvent).saveAs(path.join(generated,"drawing-project.oled.zip"));
  const drawnPackage=await unpackProject(new Uint8Array(await readFile(path.join(generated,"drawing-project.oled.zip"))));
  assert.deepEqual(Array.from(drawnPackage.resources.find(r=>r.id===drawn.id).data),[191,31]);
  assert.equal(drawnPackage.pages[0].components.at(-1).resourceId,drawn.id);
  report.resources.drawing={strokeInterpolation:true,rightErase:true,contextMenuSuppressed:true,autoCrop:true,erasureShrinksBounds:true,emptyRejected:true,undoRedo:true,clearUndo:true,packedXbm:true,sidebarAddEdit:true};
  await page.locator("#project-library").click();
  await page.locator("#new-project").click();
  await clickSetting(page, "#save-now"); await page.evaluate(() => window.oledStudio.flush());
  const disposableId = await page.evaluate(() => window.oledStudio.project().id);
  await page.locator("#project-library").click();
  await page.locator(`.project-card[data-project-id="${disposableId}"]`).getByRole("button", { name: "删除缓存条目", exact: true }).click();
  await page.waitForFunction(id => !document.querySelector(`.project-card[data-project-id="${id}"]`), disposableId);
  await page.keyboard.press("Delete");
  await page.reload(); await page.waitForFunction(() => window.oledStudio?.ready);
  await page.waitForFunction(() => !document.querySelector("#project-count").textContent.includes("正在"));
  assert.equal(await page.locator(`.project-card[data-project-id="${disposableId}"]`).count(), 0, "deleted active project must not reappear after reload");
  report.editor.homepage.activeDeletePersists = true;
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await writeFile(path.join(root, "test-results", reportName + ".json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
