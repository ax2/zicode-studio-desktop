import { expect, it } from "vitest";
import { prepareToolInput, toolFields } from "./manual-tool-fields";

it("supports declared flat scalar types with bounded enum and range metadata", () => {
  const fields = toolFields({type:"object",required:["flag","count"],properties:{flag:{type:"boolean"},count:{type:"integer",minimum:0,maximum:10},ratio:{type:"number",enum:[0,0.5,1]},text:{type:"string",enum:["", "x"]}}});
  expect(fields?.map(field=>field.kind)).toEqual(["boolean","integer","number","string"]);
  expect(prepareToolInput(fields ?? [],{flag:"1",count:"0",ratio:"1",text:"0"})).toEqual({input:{flag:false,count:0,ratio:0.5,text:""}});
});
it("distinguishes optional absence from false, zero and empty text", () => {
  const fields = toolFields({type:"object",properties:{flag:{type:"boolean"},count:{type:"number"},text:{type:"string"}}}) ?? [];
  expect(prepareToolInput(fields,{})).toEqual({input:{}});
  expect(prepareToolInput(fields,{flag:"",count:""})).toEqual({input:{}});
  expect(prepareToolInput(fields,{flag:"1",count:"0",text:""})).toEqual({input:{flag:false,count:0,text:""}});
});
it("validates required values, unicode length and numeric ranges before invoking", () => {
  const fields = toolFields({type:"object",required:["flag","count"],properties:{flag:{type:"boolean"},count:{type:"integer",minimum:0,maximum:3},text:{type:"string",minLength:1,maxLength:1}}}) ?? [];
  expect(prepareToolInput(fields,{})).toMatchObject({field:"flag"});
  expect(prepareToolInput(fields,{flag:"0"})).toMatchObject({field:"count"});
  expect(prepareToolInput(fields,{flag:"1",count:"4"})).toMatchObject({field:"count",error:expect.stringContaining("range")});
  expect(prepareToolInput(fields,{flag:"1",count:"2",text:"😀"})).toEqual({input:{flag:false,count:2,text:"😀"}});
  expect(prepareToolInput(fields,{flag:"1",count:"2",text:"😀a"})).toMatchObject({field:"text"});
  expect(prepareToolInput(toolFields({type:"object",properties:{value:{type:"integer",minimum:0.5}}}) ?? [],{value:"1"})).toEqual({input:{value:1}});
});
it("rejects precision loss, overflow, underflow, negative zero and non-JSON numbers", () => {
  const fields = toolFields({type:"object",required:["value"],properties:{value:{type:"number"}}}) ?? [];
  for(const raw of ["NaN","Infinity","0x10","+1","01","1e309","1e-1000","9007199254740993","0.100000000000000001","-0","-0.0","1,5"]) expect(prepareToolInput(fields,{value:raw})).toHaveProperty("error");
  for(const [raw,value] of [["1e3",1000],["0.1",0.1],["1.2300",1.23],["-2.5e-3",-0.0025],[" 0 ",0]] as const) expect(prepareToolInput(fields,{value:raw})).toEqual({input:{value}});
  const integer = toolFields({type:"object",properties:{value:{type:"integer"}}}) ?? [];
  for(const raw of ["1.2","9007199254740992"]) expect(prepareToolInput(integer,{value:raw})).toHaveProperty("error");
});
it("prepares JSON arrays and objects without converting them to strings", () => {
  const fields = toolFields({type:"object",required:["entries","options"],properties:{
    entries:{type:"array",items:{type:"string"},minItems:1},
    options:{type:"object",additionalProperties:false,required:["enabled"],properties:{enabled:{type:"boolean"}}},
  }}) ?? [];
  expect(fields.map(field => field.kind)).toEqual(["array","object"]);
  expect(prepareToolInput(fields,{entries:'["a","b"]',options:'{"enabled":false}'})).toEqual({input:{entries:["a","b"],options:{enabled:false}}});
  expect(prepareToolInput(fields,{entries:'{"a":1}',options:'{}'})).toMatchObject({field:"entries"});
  expect(prepareToolInput(fields,{entries:'[9007199254740993]',options:'{}'})).toMatchObject({field:"entries"});
});
it("renders Host-supported object property limits at the root and within JSON fields", () => {
  const fields = toolFields({ type: "object", minProperties: 1, maxProperties: 1,
    properties: { value: { type: "object", maxProperties: 128 } }, required: ["value"], additionalProperties: false });
  expect(fields?.map(field => field.kind)).toEqual(["object"]);
  expect(prepareToolInput(fields ?? [], { value: '{"name":"ZiCode"}' })).toEqual({ input: { value: { name: "ZiCode" } } });
  expect(toolFields({ type: "object", minProperties: 2, maxProperties: 1, properties: {} })).toBeNull();
});
it("rejects unsupported or malformed schema declarations instead of dropping constraints", () => {
  for(const schema of [
    {type:"object",required:"value",properties:{}},
    {type:"object",required:["toString"],properties:{}},
    {type:"object",additionalProperties:{type:"string"},properties:{}},
    ...[{type:"null"},{type:"array",items:{type:"string",pattern:"x"}},{type:"object",properties:{value:{type:"string",format:"uri"}}},{type:"integer",minimum:5,maximum:1},{type:"integer",minimum:9007199254740992},{type:"number",exclusiveMinimum:0},{type:"number",multipleOf:2},{type:"boolean",enum:[]},{type:"boolean",enum:[true,true]},{type:"number",enum:["1"]},{type:"integer",enum:[1.1]},{type:"number",enum:[9007199254740992]},{type:"string",minLength:40000,maxLength:50000}].map(value=>({type:"object",properties:{value}})),
  ]) expect(toolFields(schema)).toBeNull();
});
it("validates selected enum constraints and keeps prototype-named fields as own input data", () => {
  const fields = toolFields(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"value":{"type":"number","minimum":2,"enum":[1,2]}}}')) ?? [];
  expect(prepareToolInput(fields,{value:"0"})).toHaveProperty("error");
  const prepared = prepareToolInput(fields,JSON.parse('{"__proto__":"safe","value":"1"}'));
  expect("input" in prepared && Object.hasOwn(prepared.input,"__proto__")).toBe(true);
  expect("input" in prepared && prepared.input.value).toBe(2);
});
