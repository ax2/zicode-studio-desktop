import assert from "node:assert/strict";
import test from "node:test";
import { render } from "./render-release-issues.mjs";

const plan = { milestones: ["v1.1.0"], extraCompleted: [6], known: [8], exclude: { 2: "Provider-only fix" } };
const issue = (number, overrides = {}) => ({
  number, title: "Item " + number, milestone: { title: "v1.1.0" },
  state: "closed", state_reason: "completed", ...overrides,
});

test("release notes preserve original text and separate actual delivery from limitations", () => {
  const rows = [
    issue(1), issue(2), issue(3, { pull_request: {} }), issue(4, { state_reason: "not_planned" }),
    issue(5, { milestone: { title: "v1.0.0" } }), issue(6, { milestone: { title: "v1.0.0" } }),
    issue(7, { state: "open", milestone: { title: "v0.0.0" } }), issue(8, { state: "open" }),
  ];
  const result = render("# Changes\n\nKeep me.", plan, rows.reverse());
  assert.ok(result.startsWith("# Changes\n\nKeep me.\n\n## 已完成 Issue"));
  const [done, known] = result.split("## 已知问题");
  assert.deepEqual([...done.matchAll(/\[#(\d+)\]/g)].map(m => m[1]), ["1", "6"]);
  assert.deepEqual([...known.matchAll(/\[#(\d+)\]/g)].map(m => m[1]), ["7", "8"]);
  assert.throws(() => render("", plan, rows.map(i => i.number === 8 ? issue(8) : i)), /stale known issue/);
});

test("empty versions keep both sections", () => {
  const result = render("Notes", { milestones: ["v1.0.0"], extraCompleted: [], known: [], exclude: {} }, []);
  assert.match(result, /## 已完成 Issue\n\n本次无。/);
  assert.match(result, /## 已知问题\n\n本次未登记已知问题。/);
});

test("the release page supplies its own title", () => {
  const tag = "v1.1.0";
  const heading = "# ZiCode Studio Desktop " + tag;
  const output = notes => render(notes, { ...plan, extraCompleted: [], known: [], exclude: {} }, [], tag);
  for (const newline of ["\n", "\r\n"]) {
    assert.equal(output([heading, "", "## 浏览器", "更新"].join(newline)), output("## 浏览器"+newline+"更新"));
  }
  assert.equal(output(heading), output(""));
  for (const text of ["# 新功能", "# ZiCode Studio Desktop v1.0.0", "介绍\n\n"+heading]) {
    assert.ok(output(text).startsWith(text+"\n\n"));
  }
});

test("keeps a frozen limitation when a later numbered release closes its issue", () => {
  const tag = "v1.9.0";
  const current = { milestones: [tag], extraCompleted: [], known: [8], exclude: {},
    knownNotes: { 8: "Still present in these installer bytes." } };
  const before = issue(8, { state: "open", milestone: { title: "v1.9.0" } });
  const later = issue(8, { milestone: { title: "v1.10.0" } });
  const expected = render("Original.", current, [before], tag);
  assert.equal(render("Original.", current, [later], tag), expected);
  assert.match(expected, /## 已知问题\n\n- \[#8\].*Still present in these installer bytes/);
});

test("still requires review when proof does not establish a fix in a later version", () => {
  const tag = "v1.9.0";
  const current = { milestones: [tag], extraCompleted: [], known: [8], exclude: {},
    knownNotes: { 8: "Pinned limitation." } };
  const later = issue(8, { milestone: { title: "v1.10.0" } });
  for (const [candidate, rows] of [
    [current, [issue(8, { milestone: { title: tag } })]],
    [current, [issue(8, { milestone: { title: "v1.8.9" } })]],
    [current, [issue(8, { milestone: { title: "v0.0.0" } })]],
    [current, [{ ...later, milestone: null }]],
    [current, [{ ...later, state_reason: "not_planned" }]],
    [current, []],
    [{ ...current, knownNotes: { 8: " " } }, [later]],
    [{ ...current, extraCompleted: [8] }, [later]],
    [{ ...current, milestones: [tag, "v1.10.0"] }, [later]],
  ]) assert.throws(() => render("Original.", candidate, rows, tag), /stale known issue/);
});
