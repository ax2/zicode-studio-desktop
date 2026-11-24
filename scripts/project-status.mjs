#!/usr/bin/env node
// Read only. Never re-add removed items or overwrite user planning changes.
import { readGitHubJson as gh, readRepositoryIssues, readRepositoryReleases } from "./project-api.mjs";
import { openIssuesInPublishedMilestones, summarizeHierarchy, summarizeVersionReserve } from "./project-hierarchy.mjs";

async function graphql(query, variables) {
  const operationName = /^query (\w+)/.exec(query)?.[1];
  const result = await gh(["api", "graphql", "--input", "-"], { query, variables, operationName });
  if (result.errors?.length) {
    const message = result.errors.map(error => error.message).join(". ").slice(0, 400);
    throw new Error(`GitHub ${operationName ?? "GraphQL"}: ${message}`);
  }
  return result.data;
}

const query = `query ProjectItems($cursor:String){user(login:"ax2"){projectV2(number:4){
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
async function readProjectItems() {
  let cursor = null;
  let project;
  const items = [];
  do {
    const data = (await graphql(query, { cursor })).user.projectV2;
    if (!data || data.closed) throw new Error("Project unavailable or closed; do not start new work.");
    project = { title: data.title, url: data.url, updatedAt: data.updatedAt, views: data.views.nodes };
    for (const item of data.items.nodes) {
      const fields = Object.fromEntries(item.fieldValues.nodes.filter(v => v.field).map(v => [v.field.name, v.name ?? v.text ?? v.date]));
      items.push({ ...item.content, id: item.id, archived: item.isArchived, projectItemUpdatedAt: item.updatedAt, fields });
    }
    cursor = data.items.pageInfo.hasNextPage ? data.items.pageInfo.endCursor : null;
  } while (cursor);
  return { project, items };
}

async function allPages(endpoint) {
  const results = [];
  for (let page = 1; ; page++) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const batch = await gh(["api", `${endpoint}${separator}per_page=100&page=${page}`]);
    results.push(...batch);
    if (batch.length < 100) return results;
  }
}

const repo = "ax2/zicode-studio-desktop";
try {
  const [{ project, items }, { issues: repositoryIssues, parents }, releases, repositoryMilestones] = await Promise.all([
    readProjectItems(),
    readRepositoryIssues(graphql, repo),
    readRepositoryReleases(graphql, repo),
    allPages(`repos/${repo}/milestones?state=all`),
  ]);
  const openPublishedMilestoneIssues = openIssuesInPublishedMilestones(repositoryIssues, releases);
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
  const releaseReserve = summarizeVersionReserve(repositoryMilestones, releases, versionMilestone, missingVersionViews);
  // GitHub milestone counters can include pull requests or lag behind issue moves.
  const activeVersionTitles = new Set(repositoryIssues.filter(i => i.state === "open").map(i => i.milestone?.title));
  const activeReleaseMilestonesWithoutView = missingVersionViews
    .filter(m => activeVersionTitles.has(m.title))
    .map(milestoneSummary);
  const known = new Set(items.map(i => i.url));
  const untracked = repositoryIssues
    .filter(issue => issue.state === "open" && !known.has(issue.html_url))
    .map(issueSummary);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...project, items, milestones, releaseReserve, untracked, openPublishedMilestoneIssues, issuesWithoutMilestone, issuesWithoutVersionMilestone, releaseMilestonesWithoutView, activeReleaseMilestonesWithoutView, hierarchy,
    instruction: "Read selected issue body, all comments and dependencies before work. Untracked items are for review only; do not automatically re-add removed work." }, null, 2));

  if (process.argv.includes("--check-milestones") && (issuesWithoutVersionMilestone.length || activeReleaseMilestonesWithoutView.length)) {
    process.exitCode = 1;
  }
} catch (reason) {
  const detail = reason instanceof Error ? reason.message : String(reason);
  console.error(`Project audit failed: ${detail}`);
  process.exitCode = 1;
}
