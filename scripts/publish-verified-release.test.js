// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubApi, publishVerified } from "./publish-verified-release.mjs";
const options = {
  tag: "v0.6.7",
  sha: "a".repeat(40),
  run: "100",
  repository: "ax2/zicode-studio-desktop",
  notes: "Actual notes",
  files: ["a_x64-setup.exe", "b_amd64.deb"].map((name, i) => ({
    name,
    size: i + 1,
    digest: `sha256:${String(i).repeat(64)}`,
  })),
};
function fixture() {
  const state = {
    release: null,
    files: [],
    actions: [],
    commit: options.sha,
    fail: false,
    latest: { tag_name: "v0.6.2", id: 2 },
  };
  const api = {
    tagCommit: () => state.commit,
    byTag: () => state.release,
    latest: () => state.latest,
    create: (data) => {
      state.actions.push(["create", data]);
      state.release = { ...data, id: 12, author: { login: "github-actions[bot]" } };
      return state.release;
    },
    assets: (id) => {
      expect(id).toBe(12);
      return state.files;
    },
    bind: (id, data) => {
      expect(id).toBe(12);
      expect(data.make_latest).toBe("false");
      state.actions.push(["bind", id]);
      Object.assign(state.release, data);
    },
    upload: (release, file) => {
      expect(release.id).toBe(12);
      expect(state.latest.id).not.toBe(12);
      state.actions.push(["upload", file.name]);
      if (state.fail && state.files.length) throw Error("interrupted");
      state.files.push({ ...file, id: 21 + state.files.length, state: "uploaded" });
    },
    removeStarter: (id) => {
      state.actions.push(["delete", id]);
      state.files = state.files.filter((f) => f.id !== id);
    },
    finish: (id, data) => {
      expect(id).toBe(12);
      state.actions.push(["finish", data]);
      Object.assign(state.release, data);
      if (data.make_latest === "true") state.latest = state.release;
    },
  };
  return { api, state, run: (extra = {}) => publishVerified(api, { ...options, ...extra }) };
}
it("creates public and non-latest, uploads by ID, then verifies before latest eligibility", async () => {
  const { run, state } = fixture();
  await run();
  expect(state.actions.map(([action]) => action)).toEqual([
    "create",
    "bind",
    "upload",
    "upload",
    "finish",
  ]);
  expect(state.actions[0][1]).toMatchObject({
    draft: false,
    make_latest: "false",
    target_commitish: options.sha,
  });
  expect(state.actions[0][1].body).toContain("正在上传");
  expect(state.release.body).not.toContain("正在上传");
  expect(state.release.make_latest).toBe("true");
  expect(state.latest.id).toBe(12);
  state.actions = [];
  await run();
  expect(state.actions).toEqual([]);
});
it("keeps an incomplete release off Latest and resumes only missing bytes from the same run", async () => {
  const { run, state } = fixture();
  state.fail = true;
  await expect(run()).rejects.toThrow("interrupted");
  expect(state.release.make_latest).toBe("false");
  expect(state.latest.tag_name).toBe("v0.6.2");
  state.fail = false;
  state.actions = [];
  await run({ notes: "Issue titles changed after interruption" });
  expect(state.actions.map((a) => a[0])).toEqual(["upload", "finish"]);
  expect(state.actions[0][1]).toBe(options.files[1].name);
  expect(state.release.body).toContain(options.notes);
});
it.each([
  "foreign release",
  "different run",
  "different digest",
  "existing mismatched asset",
  "unexpected extra",
  "moved tag",
  "changed notes",
  "immutable",
  "replaced release",
])("rejects %s without publishing or overwriting existing files", async (kind) => {
  const { run, api, state } = fixture();
  state.fail = true;
  await expect(run()).rejects.toThrow();
  state.actions = [];
  let extra = {};
  if (kind === "foreign release") state.release.author.login = "other";
  if (kind === "different run") extra = { run: "101" };
  if (kind === "different digest")
    extra = { files: options.files.map((f) => ({ ...f, digest: `sha256:${"f".repeat(64)}` })) };
  if (kind === "existing mismatched asset") state.files[0].digest = `sha256:${"f".repeat(64)}`;
  if (kind === "unexpected extra") state.files.push({ name: "extra.exe" });
  if (kind === "moved tag") state.commit = "b".repeat(40);
  if (kind === "changed notes")
    state.release.body = state.release.body.replace(options.notes, "Hand-edited notes");
  if (kind === "immutable") state.release.immutable = true;
  if (kind === "replaced release") {
    let calls = 0;
    api.byTag = () => ({ ...state.release, id: ++calls === 1 ? 12 : 444 });
  }
  await expect(run(extra)).rejects.toThrow();
  expect(state.actions).toEqual([]);
});
it("recovers only a zero-byte starter on its own pending release", async () => {
  const { run, state } = fixture();
  state.fail = true;
  await expect(run()).rejects.toThrow();
  state.fail = false;
  state.files.push({
    name: options.files[1].name,
    state: "starter",
    size: 0,
    id: 63,
    uploader: { login: "github-actions[bot]" },
  });
  state.actions = [];
  await run();
  expect(state.actions.map((a) => a[0])).toEqual(["delete", "upload", "finish"]);
});
it("does not finish on incorrect remote upload digest or promote prereleases", async () => {
  const { api, state, run } = fixture(),
    upload = api.upload;
  api.upload = (release, file) => upload(release, { ...file, size: file.size + 1 });
  await expect(run()).rejects.toThrow("conflicting public attachment");
  expect(state.release.make_latest).toBe("false");
  expect(state.latest.tag_name).toBe("v0.6.2");
  const next = fixture();
  await next.run({ tag: "v0.6.7-rc.1" });
  expect(next.state.release.make_latest).toBe("false");
});
it("does not turn an older stable version into Latest when a newer release is already current", async () => {
  const { state, run } = fixture();
  state.latest = { tag_name: "v0.7.0", id: 701 };
  await run();
  expect(state.latest.id).toBe(701);
});
it("streams the actual verified bytes through the REST upload URL without creating any draft or modifying another ID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-public-release-"));
  const name = "installer_0.6.7_x64-setup.exe",
    bytes = Buffer.from([0, 1, 127, 128, 255]);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const root = `/repos/${options.repository}`;
  let rel,
    asset,
    phase = 0;
  try {
    await writeFile(join(dir, name), bytes);
    vi.stubGlobal("fetch", async (url, init) => {
      const u = new URL(url),
        route = u.pathname.slice(root.length);
      expect(u.pathname.startsWith(`${root}/`)).toBe(true);
      expect(init.headers.Authorization).toBe("Bearer synthetic-only");
      if (u.hostname === "uploads.github.com") {
        expect(phase).toBe(2);
        expect(route).toBe("/releases/71/assets");
        expect(u.searchParams.get("name")).toBe(name);
        expect(init.method).toBe("POST");
        expect(init.headers["Content-Length"]).toBe(String(bytes.length));
        const chunks = [];
        for await (const chunk of init.body) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(bytes);
        asset = { name, size: bytes.length, digest, state: "uploaded" };
        phase = 3;
        return Response.json(asset, { status: 201 });
      }
      expect(u.hostname).toBe("api.github.com");
      if (route.startsWith("/git/ref/tags/"))
        return Response.json({ object: { sha: "b".repeat(40), type: "tag" } });
      if (route.startsWith("/git/tags/"))
        return Response.json({ object: { sha: options.sha, type: "commit" } });
      if (route.startsWith("/releases/tags/"))
        return Response.json(rel || {}, { status: rel ? 200 : 404 });
      if (route === "/releases/latest") return Response.json({ tag_name: "v0.6.2", id: 60 });
      if (route === "/releases" && init.method === "POST") {
        const payload = JSON.parse(init.body);
        expect(payload).toMatchObject({
          draft: false,
          make_latest: "false",
          target_commitish: options.sha,
        });
        expect(phase).toBe(0);
        phase = 1;
        rel = {
          ...payload,
          id: 71,
          author: { login: "github-actions[bot]" },
          upload_url: `https://uploads.github.com${root}/releases/71/assets{?name,label}`,
        };
        return Response.json(rel, { status: 201 });
      }
      if (route === "/releases/71/assets") return Response.json(asset ? [asset] : []);
      if (route === "/releases/71" && init.method === "PATCH") {
        const patch = JSON.parse(init.body);
        expect(patch.make_latest).toBe(phase === 1 ? "false" : "true");
        expect([1, 3]).toContain(phase);
        phase++;
        Object.assign(rel, patch);
        return Response.json(rel);
      }
      throw Error(`Unexpected request: ${route}`);
    });
    await publishVerified(githubApi(options.repository, "synthetic-only", dir), {
      ...options,
      files: [{ name, size: bytes.length, digest }],
    });
    expect(phase).toBe(4);
  } finally {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});
