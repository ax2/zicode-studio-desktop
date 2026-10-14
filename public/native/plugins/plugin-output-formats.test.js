import { expect, it } from "vitest";
import { isBinaryOutput, isTextOutput, OUTPUT_EXTENSIONS, outputExtension } from "./plugin-output-formats.js";

it("keeps legacy indexes and maps archive and document outputs to fixed suffixes", () => {
  expect(Object.keys(OUTPUT_EXTENSIONS)).toHaveLength(27);
  expect(outputExtension("application/octet-stream")).toBe("bin");
  expect(outputExtension("application/x-zicode-archive-zip")).toBe("zip");
  expect(outputExtension("application/x-zicode-archive-targzip")).toBe("tar.gz");
  expect(outputExtension("application/x-zicode-archive-cab")).toBe("cab");
  expect(outputExtension("text/csv")).toBe("csv");
  expect(outputExtension("text/markdown")).toBe("md");
  expect(outputExtension("text/html")).toBe("html");
  expect(outputExtension("application/x-zicode-sqlite")).toBe("sqlite");
  expect(outputExtension("application/javascript")).toBeUndefined();
  expect(isBinaryOutput("application/x-zicode-archive-targzip")).toBe(true);
  expect(isBinaryOutput("application/x-zicode-sqlite")).toBe(true);
  expect(["text/plain", "text/csv", "text/markdown", "text/html"].every(isTextOutput)).toBe(true);
  expect(isTextOutput("application/x-zicode-sqlite")).toBe(false);
  expect(new Set(Object.values(OUTPUT_EXTENSIONS)).size).toBe(27);
});
