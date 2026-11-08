import test from "node:test";
import assert from "node:assert/strict";
import { symbol, cString, parseExportTarget, generateCode, exportProject, fontSymbol, fontResourceNames, fontC, resourceSymbol, resourceNames } from "../build/export.mjs";
import { readFile } from "node:fs/promises";
import { parseFontC } from "../build/c-data.mjs";
import { inspectFontRecords } from "../build/font-validation.mjs";
import { unzipSync } from "fflate";
import { createProject, createComponent } from "../build/project.mjs";

test("export targets reject unknown platforms", () => {
  for(const target of ["arduino","esp-idf","stm32-hal"])assert.equal(parseExportTarget(target),target);
  assert.throws(()=>parseExportTarget("esp32"),/不支持/);
});

test("export names preserve uniqueness and never produce reserved double underscores", () => {
  const ids = ["a-b","a_b","a--b","a__b","a_hb","a_ub","a_h_hb","a_u_ub","class","while"];
  const names = ids.map(id => symbol(id,"oled_page"));
  assert.equal(new Set(names).size,ids.length);
  for(const name of names){assert.match(name,/^[a-zA-Z][a-zA-Z0-9_]*$/);assert.ok(!name.includes("__"));}
});
test("C text export preserves UTF-8 and escapes only string syntax and controls", () => {
  const text='中文"\\\n# include <x>', escaped=cString(text);
  assert.equal(escaped,'"中文\\"\\\\\\n# include <x>"');
  assert.equal(cString("ASCII 123"),'"ASCII 123"');
  assert.equal(cString("\0"+"7\t\r\x1f\x7f"),'"\\0007\\t\\r\\037\\177"');
  assert.equal(cString("??/"),'"\\??/"');
  assert.equal(cString("???/"),'"\\?\\??/"');
});

test("font symbols use resource names with deterministic collision protection", () => {
  assert.equal(fontSymbol(" status_font.ttf "),"oled_font_status_font");
  assert.equal(fontSymbol("My Font.otf"),"oled_font_My_Font");
  assert.equal(fontSymbol("中文"),"oled_font_u4e2d_u6587");
  assert.throws(()=>fontSymbol("   "));
  const names=fontResourceNames(["status","status","status_2","status-3","status 3"].map((name,index)=>({id:String(index),name,kind:"font"})));
  assert.deepEqual([...names.values()],["oled_font_status","oled_font_status_4","oled_font_status_2","oled_font_status_3","oled_font_status_3_2"]);
  for(const name of names.values()){assert.match(name,/^[A-Za-z][A-Za-z0-9_]*$/);assert.ok(!name.includes("__"));}
});

test("font C annotations identify real glyph records without changing any bytes", async () => {
  globalThis.OLED_POLYGON_SOURCE = "/* shared polygon algorithm */";
  globalThis.OLED_U8G2_LICENSE = "test license";
  const source=await readFile(new URL("../build/builtin_fonts.c",import.meta.url),"latin1");
  const data=parseFontC(/const uint8_t [\s\S]*?;\r?\n/.exec(source)[0]).bytes;
  const text=fontC(data,"oled_font_status");
  assert.deepEqual(parseFontC(text).bytes,data);
  for(const record of inspectFontRecords(data))
    assert.ok(text.includes(`/* U+${record.code.toString(16).toUpperCase().padStart(4,"0")} `));
  const project=createProject();
  project.resources.push({id:"random-font-id",name:"status",kind:"font",license:"test",data,coverage:inspectFontRecords(data).map(record=>record.code)});
  const component=createComponent("ascii");component.fontId="random-font-id";component.text="";
  project.pages[0].components.push(component);
  const renderer={render:()=>({errors:[]}),textLines:()=>[]};
  for(const target of ["arduino","esp-idf","stm32-hal"]){
    const files=generateCode(project,renderer,target);
    assert.match(files["oled_resources.h"],/extern const uint8_t oled_font_status\[/);
    assert.ok(files[target==="arduino"?"oled_ui.cpp":"oled_ui.c"].includes("oled_font_status"));
    assert.ok(files["oled_resources.c"].includes(text));
    assert.doesNotMatch(files["oled_resources.c"],/oled_font_random/);
  }
});

test("image names normalize filenames and reserve original names across both resource kinds", () => {
  assert.equal(resourceSymbol("battery-icon.png","image"),"oled_bitmap_battery_icon");
  assert.equal(resourceSymbol("图片.bmp","image"),"oled_bitmap_u56fe_u7247");
  const resources=["icon","icon.png","icon_2","icon-3","icon 3"].map((name,index)=>({id:String(index),name,kind:"image"}));
  resources.push({id:"font",name:"icon",kind:"font"});
  const names=resourceNames(resources);
  assert.deepEqual([...names.values()],["oled_bitmap_icon","oled_bitmap_icon_4","oled_bitmap_icon_2","oled_bitmap_icon_3","oled_bitmap_icon_3_2","oled_font_icon"]);
  assert.throws(()=>resourceSymbol("   ","image"));
});

test("native platform APIs match bitmap storage and preserve page semantics", () => {
  globalThis.OLED_POLYGON_SOURCE = "/* shared polygon algorithm */";
  globalThis.OLED_U8G2_LICENSE = "test license";
  const project=createProject("Native API");
  project.pages[0].codeName="home_screen";
  project.resources.push({id:"bitmap",name:"battery_icon.png",kind:"image",license:"test */\n#error injected",width:13,height:1,data:Uint8Array.of(0xbf,0x1f)});
  for(const type of ["line","rect","circle","triangle","polygon","ascii","image","point","hline","vline","ellipse","arc","sector","progress","battery"]){
    const component=createComponent(type);
    if(type==="image")component.resourceId="bitmap";
    project.pages[0].components.push(component);
  }
  for(const [radius,fill] of [[0,true],[3,false],[3,true]]){
    const component=createComponent("rect");Object.assign(component,{radius,fill});
    project.pages[0].components.push(component);
  }
  const disc=createComponent("circle");disc.fill=true;project.pages[0].components.push(disc);
  const triangle=createComponent("triangle");triangle.fill=true;project.pages[0].components.push(triangle);
  const hidden=createComponent("ascii");hidden.visible=false;hidden.text="hidden";project.pages[0].components.push(hidden);
  const renderer={render:()=>({errors:[]}),bounds:()=>({x:0,y:0,width:1,height:1}),
    textLines:(_project,component)=>[{x:component.x,baseline:12,text:component.text}]};
  const arduino=generateCode(project,renderer,"arduino");
  assert.equal(arduino["oled_ui.c"],undefined);
  assert.match(arduino["oled_ui.cpp"],/int oled_ui_page_home_screen\(U8G2 &display\)/);
  assert.match(arduino["oled_ui.h"],/OLED_PAGE_HOME_SCREEN = 0/);
  for(const method of ["drawLine","drawFrame","drawBox","drawRFrame","drawRBox","drawCircle","drawDisc","drawTriangle","drawUTF8","drawXBMP","drawPixel","drawHLine","drawVLine","drawEllipse","drawArc"])
    assert.match(arduino["oled_ui.cpp"],new RegExp(`display\\.${method}\\(`));
  assert.doesNotMatch(arduino["oled_ui.cpp"],/u8g2_Draw|getU8g2/);
  assert.match(arduino["oled_ui.cpp"],/oled_polygon\(&display,/);
  assert.match(arduino["oled_ui.h"],/int oled_ui_draw\(U8G2 &display,/);
  assert.match(arduino["oled_resources.c"],/U8X8_PROGMEM/);
  assert.match(arduino["oled_ui.cpp"],/display\.drawXBMP\([^;]*oled_bitmap_battery_icon\)/);
  assert.match(arduino["oled_resources.h"],/extern const uint8_t oled_bitmap_battery_icon\[2\]/);
  assert.equal(arduino["oled_ui.cpp"].includes(cString("hidden")),false);
  const idf=generateCode(project,renderer,"esp-idf"),stm=generateCode(project,renderer,"stm32-hal");
  for(const files of [idf,stm]){
    assert.equal(files["oled_ui.cpp"],undefined);
    assert.match(files["oled_ui.c"],/u8g2_DrawXBM\(ctx,/);
    for(const method of ["DrawPixel","DrawHLine","DrawVLine","DrawEllipse","DrawArc"])
      assert.match(files["oled_ui.c"],new RegExp(`u8g2_${method}\\(ctx,`));
    assert.doesNotMatch(files["oled_ui.c"],/DrawXBMP|display\./);
    assert.match(files["oled_resources.c"],/const uint8_t oled_bitmap_battery_icon\[2\] =/);
    assert.match(files["oled_ui.c"],/u8g2_DrawXBM\([^;]*oled_bitmap_battery_icon\)/);
    assert.doesNotMatch(files["oled_resources.c"],/U8X8_PROGMEM/);
    assert.match(files["oled_ui.h"],/#define OLED_UI_PAGE_COUNT 1/);
    assert.match(files["oled_ui.h"],/#define OLED_UI_FULL_BUFFER 1/);
    assert.match(files["oled_ui.h"],/#define OLED_UI_ROTATION 0/);
  }
  assert.equal(idf["oled_ui.c"],stm["oled_ui.c"]);
  assert.equal(idf["oled_resources.c"],stm["oled_resources.c"]);
  for(const target of ["arduino","esp-idf","stm32-hal"]){
    const files=unzipSync(exportProject(project,renderer,target));
    assert.deepEqual(Object.keys(files).sort(),(target==="arduino" ?
      ["oled_ui.cpp","oled_ui.h","oled_resources.c","oled_resources.h","oled_polygon.h","oled_ui_arduino.hpp"] :
      ["oled_ui.c","oled_ui.h","oled_resources.c","oled_resources.h","oled_polygon.h"]).sort());
    const text=new TextDecoder().decode(files["oled_resources.c"]);
    assert.ok(text.includes("test * /"));
    assert.doesNotMatch(text,/^#error injected/m);
    assert.match(new TextDecoder().decode(files["oled_polygon.h"]),/test license/);
  }
});
