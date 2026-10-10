import { describe, expect, it } from "vitest";
import { imageDimensions } from "./plugin-resource-image.js";
function png(width = 10, height = 20) {
  const bytes = new Uint8Array(57), view = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10]); view.setUint32(8,13); bytes.set(new TextEncoder().encode("IHDR"),12);
  view.setUint32(16,width); view.setUint32(20,height); bytes.set(new TextEncoder().encode("IDAT"),37); bytes.set(new TextEncoder().encode("IEND"),49);
  return bytes;
}
describe("predecode raster dimension bounds", () => {
  it("reads bounded PNG dimensions and rejects overflow, truncation and duplicate headers", () => {
    expect(imageDimensions(png(),"image/png")).toEqual({width:10,height:20});
    for (const bytes of [png(0,1),png(4097,1),png(4096,4096),png().subarray(0,50)]) expect(()=>imageDimensions(bytes,"image/png")).toThrow();
    const duplicate=png();duplicate.set(new TextEncoder().encode("IHDR"),37);expect(()=>imageDimensions(duplicate,"image/png")).toThrow();
  });
  it("rejects animated PNG and MIME confusion before a codec is called", () => {
    for (const type of ["acTL","fcTL","fdAT"]) {const bytes=png();bytes.set(new TextEncoder().encode(type),37);expect(()=>imageDimensions(bytes,"image/png")).toThrow();}
    expect(()=>imageDimensions(png(),"image/jpeg")).toThrow();expect(()=>imageDimensions(png(),"image/svg+xml")).toThrow();
  });
  it("reads JPEG SOF and rejects excessive dimensions", () => {
    const bytes=new Uint8Array([255,216,255,192,0,8,8,0,20,0,10,1,255,218,0,2,255,217]);
    expect(imageDimensions(bytes,"image/jpeg")).toEqual({width:10,height:20});
    bytes[9]=32;expect(()=>imageDimensions(bytes,"image/jpeg")).toThrow();
  });
  it("reads lossless WebP and rejects animated containers and length mismatches", () => {
    const bytes=new Uint8Array(26),view=new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("RIFF"));view.setUint32(4,18,true);bytes.set(new TextEncoder().encode("WEBPVP8L"),8);view.setUint32(16,5,true);bytes[20]=47;view.setUint32(21,9|(19<<14),true);
    expect(imageDimensions(bytes,"image/webp")).toEqual({width:10,height:20});
    bytes.set(new TextEncoder().encode("ANIM"),12);expect(()=>imageDimensions(bytes,"image/webp")).toThrow();
    view.setUint32(4,30,true);expect(()=>imageDimensions(bytes,"image/webp")).toThrow();
  });
});
