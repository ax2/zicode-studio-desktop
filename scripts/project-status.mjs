#!/usr/bin/env node
// Read only. Never re-add removed items or overwrite user planning changes.
import { execFileSync } from "node:child_process";
import { loadMissingParents, summarizeHierarchy } from "./project-hierarchy.mjs";

function gh(args, payload) {
  const output = execFileSync("gh", args, {
    encoding: "utf8", windowsHide: true, timeout: 60000,
    input: payload === undefined ? undefined : JSON.stringify(payload),
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(output);
}

function graphql(query, variables) {
  const result = gh(["api", "graphql", "--input", "-"], { query, variables });
  if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
  return result.data;
}

const query = `query($cursor:String){user(login:"ax2"){projectV2(number:4){
  title url closed updatedAt
  views(first:100){nodes{name number filter}}
  items(first:100,after:$cursor){pageInfo{hasNextPage endCursor}nodes{
    id isArchived updatedAt
    content{__typename ... on Issue{id number title url state updatedAt milestone{title} repository{nameWithOwner}
      parent{id number url repository{nameWithOwner}}}
      ... on PullRequest{number title url state updatedAt milestone{title} repository{nameWithOwner}}
      ... on DraftIssue{title body}}
    fieldValues(first:30){nodes{
      ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}
      ... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2Field{name}}}
      ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2Field{name}}}
    }}
  }}
}}}`;
let cursor = null;
let project;
const items = [];
const parents = new Map();
do {
  const data = graphql(query, { cursor }).user.projectV2;
  if (!data || data.closed) throw new Error("Project unavailable or closed; do not start new work.");
  project = { title: data.title, url: data.url, updatedAt: data.updatedAt, views: data.views.nodes };
  for (const item of data.items.nodes) {
    if (item.content?.__typename === "Issue") parents.set(item.content.id, item.content.parent);
    const fields = Object.fromEntries(item.fieldValues.nodes.filter(v => v.field).map(v => [v.field.name, v.name ?? v.text ?? v.date]));
    items.push({ ...item.content, id: item.id, archived: item.isArchived, projectItemUpdatedAt: item.updatedAt, fields });
  }
  cursor = data.items.pageInfo.hasNextPage ? data.items.pageInfo.endCursor : null;
} while (cursor);

function allPages(endpoint) {
  const results = [];
  for (let page = 1; ; page++) {
    const batch = gh(["api", `${endpoint}&per_page=100&page=${page}`]);
    results.push(...batch);
    if (batch.length < 100) return results;
  }
}
const repo = "ax2/zicode-studio-desktop";
const repositoryIssues = allPages(`repos/${repo}/issues?state=all`).filter(issue => !issue.pull_request);
// Project items supply most parents. Include archived/removed/untracked repository
// issues in the audit without restoring them to the Project or querying one by one.
loadMissingParents(repositoryIssues, parents, ids => graphql(`query($ids:[ID!]!){nodes(ids:$ids){
    ... on Issue{id parent{id number url repository{nameWithOwner}}}
  }}`, { ids }).nodes);
const repositoryMilestones = allPages(`repos/${repo}/milestones?state=all`);
const milestones = repositoryMilestones.filter(m => m.state === "open").map(m => ({ title: m.title, url: m.html_url, dueOn: m.due_on, openIssues: m.open_issues, closedIssues: m.closed_issues }));
function issueSummary({ number, title, state, html_url }) {
  return { number, title, state, url: html_url };
}
const issuesWithoutMilestone = repositoryIssues
  .filter(issue => !issue.milestone)
  .map(issueSummary);
const versionMilestone = /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const hierarchy = summarizeHierarchy(repositoryIssues, parents, repo, versionMilestone);
const issuesWithoutVersionMilestone = repositoryIssues
  .filter(issue => !versionMilestone.test(issue.milestone?.title ?? ""))
  .map(issue => ({ ...issueSummary(issue), milestone: issue.milestone?.title ?? null }));
const missingVersionViews = repositoryMilestones
  .filter(m => versionMilestone.test(m.title))
  .filter(m => !project.views.some(view =>
    [m.title, `${m.title} 版本计划`].includes(view.name) &&
    [`milestone:${m.title}`, `milestone:"${m.title}"`].includes(view.filter)));
const milestoneSummary = ({ title, html_url }) => ({ title, url: html_url });
const releaseMilestonesWithoutView = missingVersionViews.map(milestoneSummary);
const activeReleaseMilestonesWithoutView = missingVersionViews
  .filter(m => m.open_issues > 0)
  .map(milestoneSummary);
const known = new Set(items.map(i => i.url));
const untracked = repositoryIssues
  .filter(issue => issue.state === "open" && !known.has(issue.html_url))
  .map(issueSummary);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...project, items, milestones, untracked, issuesWithoutMilestone, issuesWithoutVersionMilestone, releaseMilestonesWithoutView, activeReleaseMilestonesWithoutView, hierarchy,
  instruction: "Read selected issue body, all comments and dependencies before work. Untracked items are for review only; do not automatically re-add removed work." }, null, 2));

if (process.argv.includes("--check-milestones") && (issuesWithoutVersionMilestone.length || activeReleaseMilestonesWithoutView.length)) {
  process.exitCode = 1;
}
