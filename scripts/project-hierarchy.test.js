// @vitest-environment node
import { expect, it, vi } from "vitest";
import { loadMissingParents, openIssuesInPublishedMilestones, summarizeHierarchy } from "./project-hierarchy.mjs";

const repository = "owner/studio";
function issue(number, {state = "open", version = "v1.2.3", epic = false} = {}) {
  return {
    number, node_id: String(number), title: `Issue ${number}`, state,
    html_url: `https://github.com/${repository}/issues/${number}`,
    milestone: version ? {title: version} : null, labels: epic ? [{name:"type:epic"}] : [],
  };
}
function parent(number, repo = repository) {
  return {id:String(number), number, repository:{nameWithOwner:repo}, url:`https://github.com/${repo}/issues/${number}`};
}
const report = (issues, parents) => summarizeHierarchy(issues, parents, repository, /^v\d+\.\d+\.\d+$/);
const numbers = entries => entries.map(entry => entry.number);

it("reserves the deferred milestone for known issues below a roadmap", () => {
  const issues = [issue(1, { epic: true, version: "v0.0.0" }), issue(2, { version: "v0.0.0" })];
  const result = report(issues, new Map([["1", null], ["2", parent(1)]]));
  expect(numbers(result.rootsWithoutVersionMilestone)).toEqual([1]);
  expect(result.withParent).toBe(1);
});

it("retains closed descendants, manual targets and nested parents", () => {
  const issues = [issue(1,{epic:true}), issue(2,{version:"v2.0.0"}), issue(3,{state:"closed",version:"v0.9.0"}),
    issue(4,{state:"closed",version:null}), issue(5,{epic:true,version:"later"})];
  const result = report(issues, new Map([["1",null],["2",parent(1)],["3",parent(2)],["4",null],["5",null]]));
  expect(result.deeperThanTwoLevels).toEqual([{number:3, parent:2, depth:3}]);
  expect(result.total).toBe(5);
  expect(result.withParent).toBe(2);
  expect(numbers(result.roots)).toEqual([1,4,5]);
  expect(result.rootsWithoutEpic[0]).toMatchObject({number:4,state:"closed"});
  expect(numbers(result.rootsWithoutVersionMilestone)).toEqual([4,5]);
  expect(result.roots[0].milestone).toBe("v1.2.3");
});

it("separates incomplete and cross-repository data from missing parent violations and reports cycles once", () => {
  const issues = [1,2,3,4,5,6].map(n => issue(n));
  const result = report(issues, new Map([["1",parent(2)],["2",parent(1)],["3",parent(2)],
    ["4",parent(20)],["5",parent(21,"another/repo")]]));
  expect(result.rootsWithoutEpic).toEqual([]);
  expect(numbers(result.unavailable)).toEqual([6]);
  expect(numbers(result.unresolvedParents)).toEqual([4]);
  expect(numbers(result.externalParents)).toEqual([5]);
  expect(result.cycles).toEqual([[1,2]]);
  expect(result.deeperThanTwoLevels).toEqual([]);
});

it("finds fourth-level issues when descendants precede their parents", () => {
  const issues = [4,3,2,1,5].map(n => issue(n));
  const parents = new Map([["1",null],["2",parent(1)],["3",parent(2)],["4",parent(3)],["5",parent(3)]]);
  expect(report(issues, parents).deeperThanTwoLevels).toEqual([
    {number:3, parent:2, depth:3}, {number:4, parent:3, depth:4}, {number:5, parent:3, depth:4},
  ]);
});

it("matches open issues to published releases by exact milestone, including published prereleases", () => {
  const issues = [issue(1), issue(2,{state:"closed"}), issue(3,{version:"v1.2.4"}),
    issue(4,{version:"v1.2.3-rc.1"}), issue(5,{version:null}), issue(6,{version:"v1.2.30"})];
  const releases = [
    {tag_name:"v1.2.3",draft:false,published_at:"2026-11-20"},
    {tag_name:"v1.2.4",draft:true,published_at:null},
    {tag_name:"v1.2.3-rc.1",draft:false,prerelease:true,published_at:"2026-11-19"},
  ];
  expect(numbers(openIssuesInPublishedMilestones(issues, releases))).toEqual([1,4]);
});

it("reuses Project parents including confirmed roots and batches only missing repository nodes", () => {
  const issues = Array.from({length:205}, (_,i) => issue(i + 1));
  const parents = new Map([["1",null],["2",parent(1)]]);
  const read = vi.fn(ids => ids.map(id => id === "5" ? null : {id, parent:parent(1)}));
  loadMissingParents(issues, parents, read);
  expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([100,100,3]);
  expect(read.mock.calls[0][0][0]).toBe("3");
  expect(parents.get("1")).toBe(null);
  expect(parents.has("5")).toBe(false);
  loadMissingParents(issues.slice(0,2), parents, () => {throw Error("Duplicate request")});
});
