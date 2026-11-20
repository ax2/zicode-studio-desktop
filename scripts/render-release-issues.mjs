import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function render(notes, plan, issues, tag) {
  if (!Array.isArray(plan.milestones) || !plan.milestones.length || !Array.isArray(plan.known)
      || !Array.isArray(plan.extraCompleted) || !plan.exclude || Array.isArray(plan.exclude))
    throw Error("Incomplete release issue plan");
  if (/^## (已完成 Issue|已知问题)\s*$/m.test(notes)) throw Error("Duplicate issue section");
  const byId = new Map(issues.filter(i => !i.pull_request).map(i => [i.number,i]));
  const done = i => i?.state === "closed" && i.state_reason === "completed";
  for (const id of plan.extraCompleted) if (!done(byId.get(id))) throw Error("Not completed: "+id);
  for (const [id,reason] of Object.entries(plan.exclude)) if (!byId.has(Number(id)) || !reason.trim()) throw Error("Invalid exclusion: "+id);
  const completed = [...byId.values()].filter(i => done(i) && !Object.hasOwn(plan.exclude,i.number)
    && (plan.milestones.includes(i.milestone?.title) || plan.extraCompleted.includes(i.number)));
  const known = new Set([...plan.known,...[...byId.values()].filter(i=>i.state==="open" && i.milestone?.title==="v0.0.0").map(i=>i.number)]);
  for (const id of Object.keys(plan.knownNotes ?? {})) if (!known.has(Number(id))) throw Error("Unlisted known issue: "+id);
  const open = [...known].map(id=>{const i=byId.get(id);if(i?.state!=="open")throw Error("Review stale known issue: "+id);return {...i,title:plan.knownNotes?.[id] || i.title};});
  const lines = rows => rows.sort((a,b)=>a.number-b.number).map(i=>"- [#"+i.number+"](https://github.com/ax2/zicode-studio-desktop/issues/"+i.number+") "+i.title.replace(/[\r\n]/g," ")).join("\n");
  const body = notes.replace(
    /^# ZiCode Studio Desktop (v\S+)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/,
    (heading, version) => version === tag ? "" : heading,
  ).trimEnd();
  return (body ? body+"\n\n" : "")+"## 已完成 Issue\n\n"+(lines(completed)||"本次无。")+"\n\n## 已知问题\n\n"+(lines(open)||"本次未登记已知问题。")+"\n";
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [tag,source,output]=process.argv.slice(2);
  if(!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)||!source||!output)throw Error("Expected tag, source and output");
  const plan=JSON.parse(readFileSync("docs/releases/"+tag+".issues.json","utf8"));
  if(!plan.milestones.includes(tag))throw Error("Release milestone missing");
  const pages=JSON.parse(execFileSync("gh",["api","--paginate","--slurp","repos/ax2/zicode-studio-desktop/issues?state=all&per_page=100"],{encoding:"utf8",maxBuffer:32*1024*1024}));
  writeFileSync(output,render(readFileSync(source,"utf8"),plan,pages.flat(),tag));
}
