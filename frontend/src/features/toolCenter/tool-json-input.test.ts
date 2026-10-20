import { expect, it } from "vitest";
import { editableJsonSchema, parseToolJson } from "./tool-json-input";

it("accepts Host-supported nested schemas and rejects unimplemented constraints", () => {
  expect(editableJsonSchema({type:"object",properties:{items:{type:"array",minItems:1,items:{type:"string",maxLength:8}}}})).toBe(true);
  expect(editableJsonSchema({type:"object",maxProperties:128})).toBe(true);
  for (const schema of [
    {type:"array",items:{type:"string",pattern:"^x"}},
    {type:"object",additionalProperties:{type:"string"}},
    {type:"array",items:true},
    {type:"array",minItems:2,maxItems:1},
    {type:"object",minProperties:3,maxProperties:2},
    {type:"object",maxProperties:-1},
    {type:"object",maxProperties:1.5},
    {type:"object",properties:{value:{type:["string","null"]}}},
  ]) expect(editableJsonSchema(schema)).toBe(false);
});

it("preserves JSON shapes and rejects numeric precision loss before parsing", () => {
  expect(parseToolJson('["9007199254740993",{"value":1e3}]',"array")).toEqual({value:["9007199254740993",{value:1000}]});
  const prototypeNamed = parseToolJson('{"__proto__":{"safe":true}}',"object");
  expect("value" in prototypeNamed && typeof prototypeNamed.value === "object" && prototypeNamed.value !== null &&
    Object.hasOwn(prototypeNamed.value,"__proto__")).toBe(true);
  for (const raw of ['[9007199254740993]','{"n":0.100000000000000001}','[-0]','[1e309]','[1e-1000]']) {
    expect(parseToolJson(raw,raw.startsWith("[") ? "array" : "object")).toHaveProperty("error",expect.stringContaining("number"));
  }
  expect(parseToolJson("{}","array")).toEqual({error:"Enter a JSON array."});
  expect(parseToolJson("[]","object")).toEqual({error:"Enter a JSON object."});
  expect(parseToolJson("[1,]","array")).toEqual({error:"Enter valid JSON."});
  expect(parseToolJson('{"name":1,"\\u006eame":2}',"object")).toEqual({error:"JSON object contains duplicate keys."});
  expect(parseToolJson(JSON.stringify(["😀".repeat(9000)]),"array")).toHaveProperty("error");
});
