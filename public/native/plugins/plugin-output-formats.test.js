import { expect, it } from "vitest";
import { isBinaryOutput, OUTPUT_EXTENSIONS, outputExtension } from "./plugin-output-formats.js";

it("keeps legacy types and 18 distinct archive suffixes without accepting unknown MIME", () => {
  expect(Object.keys(OUTPUT_EXTENSIONS)).toHaveLength(23);
  expect(outputExtension("application/octet-stream")).toBe("bin");
  expect(outputExtension("application/x-zicode-archive-zip")).toBe("zip");
  expect(outputExtension("application/x-zicode-archive-targzip")).toBe("tar.gz");
  expect(outputExtension("application/x-zicode-archive-cab")).toBe("cab");
  expect(outputExtension("text/html")).toBeUndefined();
  expect(isBinaryOutput("application/x-zicode-archive-targzip")).toBe(true);
  expect(new Set(Object.values(OUTPUT_EXTENSIONS)).size).toBe(23);
});
