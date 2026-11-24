import { execFile } from "node:child_process";

export function readGitHubJson(args, payload, run = execFile) {
  const operation = payload?.operationName ?? args[1] ?? args[0];
  return new Promise((resolve, reject) => {
    function start(retry) {
      const child = run("gh", args, {
        encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024,
      }, (reason, stdout, stderr) => {
        if (reason) {
          if (retry && stderr?.includes("TLS handshake timeout")) {
            start(false);
            return;
          }
          const detail = typeof reason.code === "string" ? reason.code : reason.killed ? "ETIMEDOUT" :
            stderr?.trim().slice(0, 400) || reason.signal || `exit ${reason.code}`;
          reject(new Error(`GitHub ${operation} failed (${detail})`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`GitHub ${operation} returned invalid JSON`));
        }
      });
      // A failed command can close stdin before the request has finished writing.
      // Its exit callback still reports the actionable error.
      child.stdin.on("error", () => {});
      child.stdin.end(payload === undefined ? undefined : JSON.stringify(payload));
    }
    start(true);
  });
}

const labelFields = "nodes{name} pageInfo{hasNextPage endCursor}";
const issueQuery = `query RepositoryIssues($owner:String!,$name:String!,$cursor:String){
  repository(owner:$owner,name:$name){
    issues(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:DESC}){
      totalCount pageInfo{hasNextPage endCursor}
      nodes{
        node_id:id number title html_url:url state milestone{title}
        parent{id number url repository{nameWithOwner}}
        labels(first:100){${labelFields}}
      }
    }
  }
}`;
const labelQuery = `query IssueLabels($id:ID!,$cursor:String!){node(id:$id){
  ... on Issue{labels(first:100,after:$cursor){${labelFields}}}
}}`;

function nextCursor(pageInfo, previous, connection) {
  if (pageInfo?.hasNextPage === false) return null;
  if (pageInfo?.hasNextPage !== true || typeof pageInfo.endCursor !== "string" ||
      !pageInfo.endCursor || pageInfo.endCursor === previous) {
    throw new Error(`Incomplete GitHub ${connection} pagination`);
  }
  return pageInfo.endCursor;
}

async function readLabels(graphql, id, firstPage) {
  const result = [];
  let page = firstPage;
  let cursor = null;
  for (;;) {
    if (!Array.isArray(page?.nodes) || page.nodes.some(node => typeof node?.name !== "string")) {
      throw new Error(`Incomplete GitHub issue labels for ${id}`);
    }
    result.push(...page.nodes);
    cursor = nextCursor(page.pageInfo, cursor, "issue labels");
    if (!cursor) return result;
    page = (await graphql(labelQuery, { id, cursor }))?.node?.labels;
  }
}

// The repository Issue connection excludes pull requests and also includes closed
// issues that were never added to the Project. Parents come from the same read.
export async function readRepositoryIssues(graphql, repository) {
  const [owner, name] = repository.split("/");
  const issues = [], parents = new Map();
  let cursor = null, count;
  do {
    const page = (await graphql(issueQuery, { owner, name, cursor }))?.repository?.issues;
    if (!Array.isArray(page?.nodes) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0) {
      throw new Error("Incomplete GitHub repository issue response");
    }
    count ??= page.totalCount;
    if (page.totalCount !== count) throw new Error("GitHub repository issues changed during the audit");
    for (const node of page.nodes) {
      if (!node?.node_id || parents.has(node.node_id) || !["OPEN", "CLOSED"].includes(node.state) ||
          !Object.hasOwn(node, "parent") || !Object.hasOwn(node, "milestone")) {
        throw new Error("Missing or repeated GitHub repository issue");
      }
      const { labels, parent, ...issue } = node;
      issues.push({ ...issue, state: issue.state.toLowerCase(), labels: await readLabels(graphql, issue.node_id, labels) });
      parents.set(issue.node_id, parent);
    }
    cursor = nextCursor(page.pageInfo, cursor, "repository issue");
  } while (cursor);
  if (issues.length !== count) throw new Error("Incomplete GitHub repository issue list");
  return { issues, parents };
}

const releaseQuery = `query RepositoryReleases($owner:String!,$name:String!,$cursor:String){
  repository(owner:$owner,name:$name){
    releases(first:100,after:$cursor){
      pageInfo{hasNextPage endCursor} nodes{tag_name:tagName draft:isDraft published_at:publishedAt}
    }
  }
}`;

export async function readRepositoryReleases(graphql, repository) {
  const [owner, name] = repository.split("/");
  const releases = [];
  let cursor = null;
  do {
    const page = (await graphql(releaseQuery, { owner, name, cursor }))?.repository?.releases;
    if (!Array.isArray(page?.nodes) || page.nodes.some(release =>
      typeof release?.tag_name !== "string" || typeof release.draft !== "boolean" || !Object.hasOwn(release, "published_at")
    )) {
      throw new Error("Incomplete GitHub repository release response");
    }
    releases.push(...page.nodes);
    cursor = nextCursor(page.pageInfo, cursor, "repository release");
  } while (cursor);
  return releases;
}
