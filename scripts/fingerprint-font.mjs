import { chromium } from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import opentype from 'opentype.js';
const out='C:/Users/BaoPC/Desktop/oled/fingerprint-lock';
await mkdir(out+'/resources',{recursive:true}); await mkdir(out+'/sources',{recursive:true});
const source=await readFile('C:/Users/BaoPC/Desktop/oled/SimSun-01.ttf');
const parsed=opentype.parse(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength));
await writeFile(out+'/font-source-metadata.json',JSON.stringify({names:parsed.names,fsType:parsed.tables.os2?.fsType},null,2));
console.log(JSON.stringify({names:parsed.names,fsType:parsed.tables.os2?.fsType}));
const text='指纹锁已上锁请按指纹密码开锁输入密码返回确认指纹管理添加指纹指纹列表删除指纹系统设置管理员用户请放手指录入中再次按压取消继续删除确认不可恢复保留删除开锁成功欢迎回家验证失败请重试剩余次数自动上锁提示音开启关闭电量';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage(); await page.goto(pathToFileURL(path.resolve('dist/oled-lab.html')).href);
 await page.waitForFunction(()=>window.oledLab?.ready);
 await page.locator('#font-file').setInputFiles('C:/Users/BaoPC/Desktop/oled/SimSun-01.ttf');
 await page.locator('#text').fill([...new Set(text)].join('')); await page.locator('#font-size').fill('12'); await page.locator('#threshold').fill('64');
 await page.locator('#convert').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('生成并经 U8g2') || document.querySelector('#status').dataset.state==='error',null,{timeout:60000});
 const status=await page.locator('#status').textContent(); console.log(status); if(!status.includes('生成并经 U8g2')) throw Error(status);
 const font=await page.evaluate(()=>{const f=window.oledLab.fontResult();return {bytes:Array.from(f.bytes),coverage:f.coverage,bdf:f.bdf,parameters:f.parameters};});
 await writeFile(out+'/resources/font-simsun-12.bin',new Uint8Array(font.bytes)); await writeFile(out+'/sources/font-simsun-12.bin',source);
 await writeFile(out+'/font-generation.json',JSON.stringify({coverage:font.coverage,parameters:font.parameters,status},null,2));
 await writeFile(out+'/font-generated.bdf',font.bdf);
} finally {await browser.close();}
