import { File as NodeFile } from "node:buffer";
import { expect, it } from "vitest";
import { readManualToolFile } from "./manual-tool-file";
import type { ToolField } from "./manual-tool-fields";
import { supportsSpringConfigFiles } from "./spring-config-files";

const tool = {
  pluginId: "com.zicode.devtools.diagnostics",
  capabilityId: "devtools.diagnostics.spring.config",
  version: "0.1.4",
};
const fields = [
  { key: "text", kind: "string", required: true, maxLength: 8192, label: "text" },
  { key: "secondary", kind: "string", required: false, maxLength: 8192, label: "secondary" },
] as const satisfies readonly ToolField[];

it("allows the reviewed Spring capability and leaves other identities or contracts on the generic form", () => {
  expect(supportsSpringConfigFiles(tool, fields)).toBe(true);
  expect(supportsSpringConfigFiles({ ...tool, version: "0.1.5" }, fields)).toBe(false);
  expect(supportsSpringConfigFiles({ ...tool, capabilityId: "devtools.diagnostics.java.threads" }, fields)).toBe(false);
  expect(supportsSpringConfigFiles(tool, [fields[0]])).toBe(false);
  expect(supportsSpringConfigFiles(tool, [fields[0], { ...fields[1], maxLength: 64 }])).toBe(false);
});

it("loads the selected file into its own Spring input and preserves CRLF after the leading BOM", async () => {
  const input = "\uFEFFserver:\r\n  port: 9000\r\n";
  const file = new NodeFile([input], "comparison.YmL") as unknown as File;
  const prior = { text: '{"server":{"port":8080}}', secondary: "prior" };
  expect(await readManualToolFile(file, prior, "spring-config-comparison")).toEqual({ secondary: input.slice(1) });
  expect(await readManualToolFile(file, prior, "spring-config-baseline")).toEqual({ text: input.slice(1) });
  expect(prior.secondary).toBe("prior");
});
