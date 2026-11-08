import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createComponent, createProject } from "../build/project.mjs";
const root=fileURLToPath(new URL("..",import.meta.url));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",headless:true});
try{
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:960}});
  const page=await context.newPage(),errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root,"dist","oled-studio.html")).href);
  await page.waitForFunction(()=>window.oledStudio?.ready);
  const types={point:"点",hline:"水平线",vline:"垂直线",ellipse:"椭圆",arc:"圆弧",sector:"扇形",progress:"进度条",battery:"电池"};
  await page.locator("#new-project").click();
  for(const [type,label] of Object.entries(types)){
    await page.locator("#component-tools").getByRole("button",{name:label,exact:true}).click();
    assert.equal(await page.evaluate(()=>window.oledStudio.project().pages[0].components.at(-1).type),type);
    const field=type==="point"?"X":type==="hline"||type==="vline"?"长度":type==="ellipse"?"水平半径":
      type==="arc"||type==="sector"?"扫过角度":type==="progress"?"当前值":"电量 %";
    const input=page.locator("#properties").getByLabel(field,{exact:true});
    await input.fill(type==="point"?"12":type==="arc"||type==="sector"?"270":"18");await input.press("Tab");
    assert.equal((await page.locator("#diagnostics").textContent()).includes("请选择"),false);
  }
  const model=createProject("OLED 高频组件");
  model.display={...model.display,width:128,height:128};
  const positions=[[6,6],[6,14],[6,20],[40,30],[88,30],[40,82],[66,65],[66,88]];
  for(const [index,type] of Object.keys(types).entries()){
    const component=createComponent(type);component.x=positions[index][0];component.y=positions[index][1];
    if(type==="progress"){component.width=52;component.height=12;component.value=60;}
    if(type==="battery"){component.width=36;component.height=18;component.charging=true;}
    model.pages[0].components.push(component);
  }
  await page.evaluate(model=>window.oledStudio.load(model),model);
  const full=await page.evaluate(()=>window.oledStudio.preview(false)),paged=await page.evaluate(()=>window.oledStudio.preview(true));
  assert.deepEqual(full,paged,"new widgets must match full/page U8g2 rendering");
  assert.ok(full.filter(Boolean).length>300);
  assert.equal(await page.locator("#diagnostics").textContent(),"");
  await page.locator("#zoom").fill("4");await page.locator("#zoom").dispatchEvent("change");
  await mkdir(path.join(root,"test-results"),{recursive:true});
  await page.screenshot({path:path.join(root,"test-results","widgets.png"),fullPage:true});
  for(const type of Object.keys(types)){
    const component=createComponent(type),project=createProject();
    project.pages[0].components=[component];
    await page.evaluate(project=>window.oledStudio.load(project),project);
    await page.locator("#components").getByRole("button",{name:component.name,exact:true}).click();
    const x=component.x+(type==="hline"?component.length-1:type==="ellipse"?component.rx:
      type==="arc"||type==="sector"?component.radius:type==="progress"||type==="battery"?component.width-1:0);
    const y=component.y+(type==="vline"?component.length-1:type==="ellipse"?component.ry:
      type==="progress"||type==="battery"?component.height-1:0);
    const canvas=await page.locator("#overlay").boundingBox();
    await page.mouse.move(canvas.x+(x+0.5)*4,canvas.y+(y+0.5)*4);await page.mouse.down();
    await page.mouse.move(canvas.x+(x+4.5)*4,canvas.y+(y+2.5)*4,{steps:4});await page.mouse.up();
    const changed=await page.evaluate(()=>window.oledStudio.project().pages[0].components[0]);
    const field=type==="point"?"x":type==="hline"||type==="vline"?"length":type==="ellipse"?"rx":
      type==="arc"||type==="sector"?"radius":"width";
    assert.notEqual(changed[field],component[field],`${type} drag handle must update geometry`);
    await page.locator("#undo").click();
    assert.deepEqual(await page.evaluate(()=>window.oledStudio.project().pages[0].components[0]),component);
  }
  for(const value of [0,50,100]){
    const progress={...createComponent("progress"),x:0,y:0,width:12,height:8,value};
    const project=createProject();project.pages[0].components=[progress];
    await page.evaluate(project=>window.oledStudio.load(project),project);
    const bits=await page.evaluate(()=>window.oledStudio.preview());
    assert.equal(bits.filter(Boolean).length,36+(value===0?0:value===50?30:60));
  }
  const shapes=[
    {...createComponent("point"),x:0,y:0},
    {...createComponent("hline"),x:0,y:0,length:35},
    {...createComponent("vline"),x:0,y:0,length:35}
  ];
  for(const [index,component] of shapes.entries()){
    const project=createProject();project.pages[0].components=[component];
    await page.evaluate(project=>window.oledStudio.load(project),project);
    const bits=await page.evaluate(()=>window.oledStudio.preview());
    assert.equal(bits.filter(Boolean).length,index===0?1:35);
    if(index===1)assert.ok(bits.slice(0,35).every(Boolean));
    if(index===2)for(let y=0;y<35;y++)assert.equal(bits[y*128],1);
  }
  assert.deepEqual(errors,[]);
  console.log("Eight new UI controls, native full/page pixels, exact progress endpoints and point/H/V lines passed. No MCU compilation.");
}finally{await browser.close();}
