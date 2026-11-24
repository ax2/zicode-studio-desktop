// @vitest-environment node
import { expect, it, vi } from "vitest";
import { readGitHubJson, readRepositoryIssues, readRepositoryReleases } from "./project-api.mjs";
import { summarizeHierarchy } from "./project-hierarchy.mjs";

const repository = "owner/studio";
const pageInfo = cursor => ({ hasNextPage: Boolean(cursor), endCursor: cursor ?? null });
const labelPage = (names = [], cursor) => ({ nodes: names.map(name => ({ name })), pageInfo: pageInfo(cursor) });
const parent = number => ({ id: String(number), number, url: `https://github.com/${repository}/issues/${number}`,
  repository: { nameWithOwner: repository } });
const item = (number, fields = {}) => ({
  node_id: String(number), number, state: "OPEN", title: `Issue ${number}`, html_url: parent(number).url,
  parent: null, milestone: { title: "v1.2.3" }, labels: labelPage(), ...fields,
});
const issuesPage = (nodes, totalCount, cursor) => ({ repository: { issues: { nodes, totalCount, pageInfo: pageInfo(cursor) } } });

it("uses stable cursor pagination for repository issues, including closed issue ancestry outside the Project", async () => {
  const root = item(1, { labels: labelPage(["type:epic"]) });
  const closed = item(2, { state: "CLOSED", parent: parent(1), milestone: null });
  const read = vi.fn()
    .mockReturnValueOnce(issuesPage([closed], 2, "second-page"))
    .mockReturnValueOnce(issuesPage([root], 2));
  const { issues, parents } = await readRepositoryIssues(read, repository);

  expect(read.mock.calls.map(([, variables]) => variables)).toEqual([
    { owner: "owner", name: "studio", cursor: null },
    { owner: "owner", name: "studio", cursor: "second-page" },
  ]);
  expect(read.mock.calls[0][0]).toContain("issues(first:100,after:$cursor");
  expect(read.mock.calls[0][0]).not.toMatch(/\b(body|pullRequests)\b/);
  expect(issues[0]).toMatchObject({ node_id: "2", state: "closed", milestone: null, labels: [] });
  expect(parents.get("2")).toEqual(parent(1));
  expect(parents.get("1")).toBeNull();
  const result = summarizeHierarchy(issues, parents, repository, /^v\d+\.\d+\.\d+$/);
  expect(result).toMatchObject({ total: 2, withParent: 1, rootsWithoutEpic: [], unavailable: [] });
});

it("reads additional label pages when the initial issue payload does not contain the last labels", async () => {
  const root = item(1, { labels: labelPage(["existing"], "next-labels") });
  const read = vi.fn()
    .mockReturnValueOnce(issuesPage([root], 1))
    .mockReturnValueOnce({ node: { labels: labelPage(["type:epic"]) } });
  const { issues } = await readRepositoryIssues(read, repository);

  expect(issues[0].labels).toEqual([{ name: "existing" }, { name: "type:epic" }]);
  expect(read.mock.calls[1][1]).toEqual({ id: "1", cursor: "next-labels" });
});

it("rejects incomplete issues, stalled cursors and changing totals instead of accepting partial audits", async () => {
  await expect(readRepositoryIssues(() => issuesPage([item(1)], 2), repository)).rejects.toThrow("Incomplete GitHub repository issue list");
  const malformed = issuesPage([item(1)], 1);
  malformed.repository.issues.pageInfo = { hasNextPage: true, endCursor: null };
  await expect(readRepositoryIssues(() => malformed, repository)).rejects.toThrow("Incomplete GitHub repository issue pagination");
  const stale = vi.fn().mockReturnValueOnce(issuesPage([item(1)], 2, "next"))
    .mockReturnValueOnce(issuesPage([item(2)], 3));
  await expect(readRepositoryIssues(stale, repository)).rejects.toThrow("repository issues changed");
  const duplicate = vi.fn().mockReturnValueOnce(issuesPage([item(1)], 2, "next"))
    .mockReturnValueOnce(issuesPage([item(1)], 2));
  await expect(readRepositoryIssues(duplicate, repository)).rejects.toThrow("Missing or repeated GitHub repository issue");
});

function cliResult(reason, output, diagnostics) {
  const stdin = { on: vi.fn(), end: vi.fn() };
  const run = vi.fn((_bin, _args, _options, finish) => {
    queueMicrotask(() => finish(reason, output, diagnostics));
    return { stdin };
  });
  return { run, stdin };
}

it("reports only the named operation and error when GitHub times out with a large partial response", async () => {
  const { run, stdin } = cliResult({ killed: true }, "incomplete sensitive body".repeat(100_000));
  const args = ["api", "graphql", "--input", "-"];
  await expect(readGitHubJson(args, { query: "fixture", operationName: "RepositoryIssues" }, run))
    .rejects.toThrow(/^GitHub RepositoryIssues failed \(ETIMEDOUT\)$/);
  expect(run.mock.calls[0]).toEqual(["gh", args, expect.objectContaining({
    windowsHide: true, timeout: 60000,
  }), expect.any(Function)]);
  expect(stdin.end).toHaveBeenCalledWith('{"query":"fixture","operationName":"RepositoryIssues"}');
});

it("distinguishes failed status, invalid JSON and a valid response", async () => {
  const args = ["api", "graphql"];
  const result = { repository: { totalCount: 3 } };
  await expect(readGitHubJson(args, undefined, cliResult(null, JSON.stringify(result)).run)).resolves.toEqual(result);
  await expect(readGitHubJson(args, undefined, cliResult({ code: 1 }, "partial", "TLS handshake timeout").run))
    .rejects.toThrow(/^GitHub graphql failed \(TLS handshake timeout\)$/);
  await expect(readGitHubJson(args, undefined, cliResult(null, "invalid response").run))
    .rejects.toThrow(/^GitHub graphql returned invalid JSON$/);
});

it("retries exactly once on a transient TLS handshake timeout", async () => {
  const failure = cliResult({ code: 1 }, "discarded", "TLS handshake timeout");
  const result = cliResult(null, '{"ok":true}');
  const run = vi.fn().mockImplementationOnce(failure.run).mockImplementationOnce(result.run);
  await expect(readGitHubJson(["api", "graphql"], undefined, run)).resolves.toEqual({ ok: true });
  expect(run).toHaveBeenCalledTimes(2);
  await expect(readGitHubJson(["api", "graphql"], undefined, failure.run)).rejects.toThrow("TLS handshake timeout");
  expect(failure.run).toHaveBeenCalledTimes(3);
});

it("reads release tag and publication data across pages without loading release notes", async () => {
  const draft = { tag_name: "v1.2.4", draft: true, published_at: null };
  const published = { tag_name: "v1.2.3", draft: false, published_at: "2026-11-20" };
  const page = (nodes, cursor) => ({ repository: { releases: { nodes, pageInfo: pageInfo(cursor) } } });
  const read = vi.fn().mockReturnValueOnce(page([draft], "next-release")).mockReturnValueOnce(page([published]));
  await expect(readRepositoryReleases(read, repository)).resolves.toEqual([draft, published]);
  expect(read.mock.calls[1][1]).toEqual({ owner: "owner", name: "studio", cursor: "next-release" });
  expect(read.mock.calls[0][0]).not.toMatch(/\b(body|description|releaseAssets)\b/);
});
