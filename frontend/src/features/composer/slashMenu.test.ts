import { describe, expect, it } from "vitest";
import {
  activeSlashQuery,
  commandInvocation,
  commandMatches,
  computeSlashMatches,
  normalizeCommands,
  titleCaseCommandName,
} from "./slashMenu";

describe("slash menu logic", () => {
  it("recognizes slash queries at the start of the composer", () => {
    const input = { value: "/skill:res", selectionStart: 10 };
    expect(activeSlashQuery(input)).toEqual({ query: "skill:res", end: 10 });

    const mid = { value: "please /skill:res", selectionStart: 17 };
    expect(activeSlashQuery(mid)).toBeNull();

    const blank = { value: "/", selectionStart: 1 };
    expect(activeSlashQuery(blank)).toEqual({ query: "", end: 1 });
  });

  it("formats command names for display", () => {
    expect(titleCaseCommandName("skill:code-review")).toBe("Code Review");
    expect(titleCaseCommandName("/skill:research")).toBe("Research");
  });

  it("normalizes skill commands and drops disabled ones", () => {
    const commands = normalizeCommands([
      { name: "settings", type: "builtin" },
      { name: "skill:research", type: "skill", scope: "user" },
      {
        name: "skill:off",
        type: "skill",
        capabilityState: "disabled",
      },
      { name: "review", source: "skill" },
    ]);
    expect(commands).toEqual([
      { name: "skill:research", type: "skill", scope: "user", command: "/skill:research" },
      { name: "review", source: "skill", command: "/review" },
    ]);
  });

  it("matches commands by name, description, and display title", () => {
    const command = {
      name: "skill:code-review",
      command: "/skill:code-review",
      description: "Review a diff",
      type: "skill",
    };
    expect(commandMatches(command, "")).toBe(true);
    expect(commandMatches(command, "review")).toBe(true);
    expect(commandMatches(command, "code review")).toBe(true);
    expect(commandMatches(command, "diff")).toBe(true);
    expect(commandMatches(command, "research")).toBe(false);
  });

  it("computes matches from an input value and command catalog", () => {
    const input = { value: "/res", selectionStart: 4 };
    const catalog = [
      { name: "skill:research", description: "Investigate sources", type: "skill" },
      { name: "skill:code-review", description: "Review a diff", type: "skill" },
      { name: "settings", type: "builtin" },
    ];
    expect(computeSlashMatches(input, catalog)).toEqual({
      query: "res",
      matches: [
        {
          name: "skill:research",
          description: "Investigate sources",
          type: "skill",
          command: "/skill:research",
        },
      ],
    });
    expect(computeSlashMatches({ value: "hello", selectionStart: 5 }, catalog)).toBeNull();
  });

  it("builds command invocations with a leading slash", () => {
    expect(commandInvocation({ name: "skill:btw" })).toBe("/skill:btw");
    expect(commandInvocation({ command: "/done" })).toBe("/done");
    expect(commandInvocation({})).toBe("");
  });
});
