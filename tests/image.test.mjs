import test from "node:test";
import assert from "node:assert/strict";
import { thresholdImage, importBitmap, parseBitmapC, imageDimensions } from "../build/image-tool.mjs";
import { unpackXbm, bitmapBounds, cropBitmap } from "../build/bitmap.mjs";

test("manual bitmap crops exact lit bounds, preserving gaps and row padding", () => {
  const bits = new Uint8Array(512 * 512);
  for(let x=10;x<23;x++)bits[10*512+x]=1;
  bits[10*512+16]=0;
  assert.deepEqual(bitmapBounds(512,512,bits),{x:10,y:10,width:13,height:1});
  assert.deepEqual(cropBitmap(512,512,bits),{width:13,height:1,data:new Uint8Array([191,31])});
  bits[511*512+511]=1;
  assert.deepEqual(bitmapBounds(512,512,bits),{x:10,y:10,width:502,height:502});
  bits.fill(0); bits[511*512+511]=1;
  assert.deepEqual(cropBitmap(512,512,bits),{width:1,height:1,data:new Uint8Array([1])});
  bits.fill(0); assert.equal(bitmapBounds(512,512,bits),undefined);
  assert.throws(()=>cropBitmap(512,512,bits),/空白/);
});

test("image threshold composites transparency and inverts only final one-bit output", () => {
  const pixels = new Uint8ClampedArray([255,255,255,0, 255,255,255,255, 128,128,128,255, 0,0,0,255]);
  const options = { threshold: 128, invert: false, background: 0, dither: false };
  assert.deepEqual(unpackXbm(4,1,thresholdImage(4,1,pixels,options)), new Uint8Array([0,1,1,0]));
  assert.deepEqual(unpackXbm(4,1,thresholdImage(4,1,pixels,{...options,invert:true})), new Uint8Array([1,0,0,1]));
  assert.equal(unpackXbm(4,1,thresholdImage(4,1,pixels,{...options,background:1}))[0], 1);
  assert.equal(unpackXbm(4,1,thresholdImage(4,1,pixels,{...options,threshold:0}))[0], 0);
});
test("external row-MSB and vertical-page bitmap imports normalize to row-LSB XBM", () => {
  const msb = new Uint8Array([0x81,0x80,0x80,0,0,0x80]);
  const lsb = importBitmap(msb,9,3,"msb"), bits = unpackXbm(9,3,lsb);
  const page = new Uint8Array(9);
  for(let y=0;y<3;y++)for(let x=0;x<9;x++)page[x]|=bits[y*9+x]<<y;
  assert.deepEqual(importBitmap(page,9,3,"page"),lsb);
  assert.throws(()=>importBitmap(new Uint8Array(5),9,3,"lsb"),/长度/);
});
test("XBM dimensions parse as data; C arrays reject expressions and length errors", () => {
  assert.deepEqual(parseBitmapC("#define icon_width 9\n#define icon_height 1\nstatic unsigned char icon_bits[] = {0x81, 1};"),
    {width:9,height:1,bytes:new Uint8Array([0x81,1])});
  assert.throws(()=>parseBitmapC("const uint8_t x[] = {alert(1)};"),/整数字节/);
  assert.throws(()=>parseBitmapC("const uint8_t x[3] = {1,2};"),/长度/);
});
test("image source dimensions are checked before decoding any compressed pixels", () => {
  const png = new Uint8Array(33), view = new DataView(png.buffer);
  view.setUint32(0,0x89504e47);view.setUint32(4,0x0d0a1a0a);view.setUint32(8,13);view.setUint32(12,0x49484452);
  view.setUint32(16,13);view.setUint32(20,3);
  assert.deepEqual(imageDimensions(png,"image/png"),[13,3]);
  view.setUint32(16,30000);view.setUint32(20,30000);
  assert.throws(()=>imageDimensions(png,"image/png"),/未进行解码/);
  assert.throws(()=>imageDimensions(new Uint8Array(5),"image/jpeg"),/文件头/);
});
