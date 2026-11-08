import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {unpackProject,packProject} from '../build/project-package.mjs';
import {inspectFont} from '../build/font-validation.mjs';
const out='C:/Users/BaoPC/Desktop/oled/fingerprint-lock'; await mkdir(out+'/previews',{recursive:true});
const project=await unpackProject(new Uint8Array(await readFile(out+'/fingerprint-lock.oled.zip')));
const coverage=inspectFont(project.resources.find(r=>r.kind==='font').data);
assert.deepEqual(coverage,project.resources.find(r=>r.kind==='font').coverage);
const roundtrip=await unpackProject(await packProject(project));assert.deepEqual(roundtrip,project);
const report={schemaVersion:1,projectId:project.id,officialParser:true,officialPackRoundtrip:true,fontCoverageParsedFromBinary:coverage,sourceFontUnchanged:false,pages:[],browserErrors:[],hardwareTested:false};
assert.deepEqual(project.resources.find(r=>r.kind==='font').source,new Uint8Array(await readFile('C:/Users/BaoPC/Desktop/oled/SimSun-01.ttf')));report.sourceFontUnchanged=true;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const ctx=await browser.newContext({offline:true,viewport:{width:1500,height:1000}});const page=await ctx.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(pathToFileURL(path.resolve('dist/oled-studio.html')).href);await page.waitForFunction(()=>window.oledStudio?.ready);
 await page.locator('#package-file').setInputFiles(out+'/fingerprint-lock.oled.zip');await page.waitForFunction(id=>window.oledStudio.project().id===id,project.id);
 report.browserFileImport=true;assert.equal(await page.locator('#pages .row').count(),10);
 for(let i=0;i<project.pages.length;i++){
  await page.locator('#pages .row').nth(i).getByRole('button').first().click();
  const full=await page.evaluate(()=>window.oledStudio.preview(false));const paged=await page.evaluate(()=>window.oledStudio.preview(true));assert.deepEqual(paged,full);assert.equal(full.length,8192);assert.ok(full.some(Boolean));
  const diagnostics=await page.locator('#diagnostics').textContent();console.log(project.pages[i].name,diagnostics);assert.ok(!/裁剪警告|缺字|请选择字库|请选择图片|字库缺字/.test(diagnostics),diagnostics);
  await writeFile(out+`/previews/page-${String(i+1).padStart(2,'0')}.raw`,new Uint8Array(full));
  report.pages.push({id:project.pages[i].id,name:project.pages[i].name,components:project.pages[i].components.length,diagnostics,fullVsPagedDifferences:0,litPixels:full.filter(Boolean).length});
 }
 // Prove this is editable, with a reversible component movement in the imported snapshot.
 await page.locator('#pages .row').first().getByRole('button').first().click();
 await page.locator('#components').getByRole('button',{name:'GUARD / 01',exact:true}).click();
 const before=await page.evaluate(()=>window.oledStudio.project().pages[0].components[0].x);await page.keyboard.press('ArrowRight');
 assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].components[0].x),before+1);await page.locator('#undo').click();assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].components[0].x),before);report.editabilityMoveAndUndo=true;
 await page.getByLabel('纯预览',{exact:true}).check();await page.screenshot({path:out+'/previews/studio-import.png',fullPage:true});
 assert.deepEqual(report.browserErrors,[]);
 await writeFile(out+'/validation-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
