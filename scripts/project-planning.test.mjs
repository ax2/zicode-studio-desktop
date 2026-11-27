import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePlanningFields } from "./project-planning.mjs";

test("planning fields apply to open active project issues, type labels to all repository issues", () => {
  const fields = {Status:"待开发", 优先级:"P1", 模块:"博客", 阶段:"近期", 负责会话:"主会话"};
  const active = {__typename:"Issue", state:"OPEN", archived:false,
    repository:{nameWithOwner:"AX2/Studio"}, fields, number:1, url:"/1"};
  const items = [
    active, {...active, number:2, url:"/2", fields:{...fields, 模块:"", 负责会话:"  "}},
    {...active, archived:true, fields:{}}, {...active, state:"CLOSED", fields:{}},
    {...active, __typename:"PullRequest", fields:{}}, {...active, repository:{nameWithOwner:"other/repo"}, fields:{}},
  ];
  const issues = [
    {number:1, html_url:"/1", labels:[{name:"type:feature"}]},
    {number:3, html_url:"/3", state:"closed", labels:[{name:"bug"}]},
    {number:4, html_url:"/4", labels:[{name:"type:"}]},
  ];
  assert.deepEqual(summarizePlanningFields(issues, items, "ax2/studio"), {
    missingFields:[{number:2,url:"/2",fields:["模块","负责会话"]}],
    issuesWithoutType:[{number:3,url:"/3"},{number:4,url:"/4"}],
  });
});
