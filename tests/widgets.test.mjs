import test from "node:test";
import assert from "node:assert/strict";
import { createComponent, createProject, parseComponent } from "../build/project.mjs";
import { widgetOperations, arcAngles } from "../build/widget-geometry.mjs";
import { packProject, unpackProject } from "../build/project-package.mjs";

test("eight new OLED component types validate and survive project packages", async () => {
  const project=createProject();
  for(const type of ["point","hline","vline","ellipse","arc","sector","progress","battery"]){
    const component=createComponent(type);
    assert.deepEqual(parseComponent(component),component);
    project.pages[0].components.push(component);
  }
  assert.deepEqual(await unpackProject(await packProject(project)),project);
  for(const [type,changes] of [["hline",{length:0}],["ellipse",{rx:0}],["arc",{sweepAngle:0}],
    ["progress",{min:100,max:0}],["progress",{value:101}],["battery",{value:-1}],["battery",{width:7}]]){
    assert.throws(()=>parseComponent({...createComponent(type),...changes}));
  }
});

test("progress fill measures exact min, half and max values horizontally and vertically", () => {
  const component={...createComponent("progress"),width:12,height:8,min:-100,max:100};
  assert.deepEqual(widgetOperations({...component,value:-100}),[{type:"frame",x:10,y:10,width:12,height:8}]);
  assert.deepEqual(widgetOperations({...component,value:0}).at(-1),{type:"box",x:11,y:11,width:5,height:6});
  assert.deepEqual(widgetOperations({...component,value:100}).at(-1),{type:"box",x:11,y:11,width:10,height:6});
  assert.deepEqual(widgetOperations({...component,vertical:true,value:0}).at(-1),{type:"box",x:11,y:14,width:10,height:3});
  assert.deepEqual(widgetOperations({...component,border:false,value:0}),[{type:"box",x:10,y:10,width:6,height:8}]);
});

test("battery level endpoints and charging mark restore draw color", () => {
  const component=createComponent("battery");
  assert.equal(widgetOperations({...component,value:0}).length,2);
  assert.deepEqual(widgetOperations({...component,value:100}).at(-1),{type:"box",x:12,y:12,width:22,height:10});
  const charging=widgetOperations({...component,charging:true});
  assert.ok(charging.some(op=>op.type==="color"&&op.bit===2));
  assert.deepEqual(charging.at(-1),{type:"color",bit:1});
});

test("arc angles wrap and sectors have bounded deterministic integer geometry", () => {
  assert.deepEqual(arcAngles(0,180),[0,128]);
  assert.deepEqual(arcAngles(270,180),[192,64]);
  assert.deepEqual(arcAngles(359,1),[255,0]);
  assert.deepEqual(arcAngles(45,360),[32,32]);
  const component=createComponent("sector");
  assert.equal(widgetOperations(component).length,60);
  assert.ok(widgetOperations(component).every(op=>op.points.every(Number.isInteger)));
  assert.deepEqual(widgetOperations({...component,sweepAngle:360}),[{type:"disc",x:35,y:30,radius:20}]);
});
