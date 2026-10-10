// @vitest-environment node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import compat from "./follow-redirects-compat.cjs";

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve("follow-redirects"), "utf8");
const { patchFollowRedirectsSource } = compat;

function errorTypes(input) {
  const realErrors = new WeakSet();
  class NativeOnlyError extends Error {
    constructor(...args) { super(...args); realErrors.add(this); }
    static captureStackTrace(target) {
      if (!realErrors.has(target)) throw new TypeError("First argument must be an Error object");
      target.stack = "captured stack";
    }
  }
  const body = input.slice(input.indexOf("function createErrorType("), input.indexOf("function destroyRequest("));
  // Execute only the installed dependency's owned fixture function in a test VM.
  return runInNewContext(`${body}; createErrorType;`, {
    Error: NativeOnlyError,
    isFunction: (value) => typeof value === "function",
  });
}

describe("follow-redirects compiled Bun compatibility", () => {
  it("reproduces the prototype-only stack target failure", () => {
    const create = errorTypes(source);
    const Parent = create("PARENT", "parent");
    expect(() => create("CHILD", "child", Parent)).toThrow("First argument must be an Error object");
  });

  it("preserves error identity, code, cause, message and stack", () => {
    const create = errorTypes(patchFollowRedirectsSource(source));
    const Parent = create("PARENT", "parent");
    const Child = create("CHILD", "child", Parent);
    const cause = new Error("original cause");
    const error = new Child({ cause });
    expect(error).toBeInstanceOf(Parent);
    expect(error).toBeInstanceOf(Child);
    expect(error.code).toBe("CHILD");
    expect(error.name).toBe("Error [CHILD]");
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("child: original cause");
    expect(error.stack).toBe("captured stack");
    expect(Object.keys(error)).not.toContain("stack");
  });

  it("refuses dependency drift or duplicate patch targets", () => {
    expect(() => patchFollowRedirectsSource("changed library")).toThrow("review Bun compatibility");
    expect(() => patchFollowRedirectsSource(source + source)).toThrow("review Bun compatibility");
  });
});
