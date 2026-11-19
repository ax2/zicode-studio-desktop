import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const bot = "github-actions[bot]";
const notice = "> 安装包正在上传并校验，请先使用上一稳定版本。\n\n";
const hash = value => createHash("sha256").update(value).digest("hex");
function page(notes, key, state, id) {
  return (state === "pending" ? notice : "") + notes + "\n\n<!-- studio-release-v1:" + key + ":" + hash(notes) + ":" + state + ":" + id + " -->";
}
function readPage(release, key, tag) {
  const marker = release?.body?.match(/\n\n<!-- studio-release-v1:([0-9a-f]{64}):([0-9a-f]{64}):(pending|complete):(\d+) -->$/);
  if (release?.draft !== false || release?.author?.login !== bot || release.tag_name !== tag ||
      release.prerelease !== tag.includes("-") || !marker || marker[1] !== key)
    throw Error("Refusing to change a release not owned by this verified workflow run");
  const state=marker[3], prefix=state==="pending"?notice:"";
  const binding=Number(marker[4]);
  if(binding!==release.id && !(binding===0 && state==="pending"))throw Error("Release marker belongs to another numeric ID");
  if (!release.body.startsWith(prefix)) throw Error("Release notice changed");
  const notes=release.body.slice(prefix.length,marker.index);
  if(hash(notes)!==marker[2])throw Error("Release notes changed outside this workflow");
  return {notes,state,binding};
}

export async function publishVerified(api,{repository,tag,sha,run,notes,files}) {
  if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag) || !/^[a-f0-9]{40}$/.test(sha) ||
      !/^\d+$/.test(run) || !files.length || !notes.trim()) throw Error("Invalid release inputs");
  const map=new Map();
  for(const {name,size,digest} of files){
    if(!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)||!Number.isSafeInteger(size)||size<=0||
       !/^sha256:[a-f0-9]{64}$/.test(digest)||map.has(name))throw Error("Invalid verified file inventory");
    map.set(name,{name,size,digest});
  }
  const key=hash(JSON.stringify([repository,tag,sha,run,[...map.keys()].sort().map(n=>map.get(n))]));
  const pin=async()=>{if(await api.tagCommit(tag)!==sha)throw Error("Release tag moved");};
  await pin();
  let release=await api.byTag(tag);
  if(!release)release=await api.create({tag_name:tag,target_commitish:sha,name:"ZiCode Studio Desktop "+tag,
    draft:false,prerelease:tag.includes("-"),make_latest:"false",body:page(notes,key,"pending",0)});
  const id=release.id;
  if(!Number.isSafeInteger(id)||id<=0)throw Error("Missing numeric release ID");
  const pageState=readPage(release,key,tag);
  const refresh=async()=>{
    await pin();
    const bound=await api.byTag(tag);
    if(bound?.id!==id)throw Error("Release was replaced; refusing to follow a new ID");
    const current=readPage(bound,key,tag);
    if(current.notes!==pageState.notes||current.state!==pageState.state||current.binding!==pageState.binding)throw Error("Release changed during upload");
    if(bound.immutable && current.state==="pending")throw Error("This repository forbids attachment changes after publication");
    return bound;
  };
  const check=async()=>{
    const found=new Map();
    for(const asset of await api.assets(id)){
      const expected=map.get(asset.name);
      if(!expected||found.has(asset.name))throw Error("Unexpected or duplicate public attachment");
      if(asset.state==="starter" && asset.size===0 && asset.uploader?.login===bot && pageState.state==="pending"){
        if(!Number.isSafeInteger(asset.id)||asset.id<=0)throw Error("Invalid starter asset ID");
      }else if(asset.state!=="uploaded"||asset.size!==expected.size||asset.digest!==expected.digest){
        throw Error("Refusing to overwrite a conflicting public attachment: "+asset.name);
      }
      found.set(asset.name,asset);
    }
    return found;
  };
  await refresh();
  let visible=await check();
  if(pageState.binding===0){
    if(visible.size)throw Error("Unbound public release already contains assets");
    await api.bind(id,{body:page(pageState.notes,key,"pending",id),make_latest:"false"});
    pageState.binding=id;await refresh();
  }
  if(pageState.state==="complete"){
    if(visible.size!==map.size)throw Error("Completed release has missing attachments");
    return id;
  }
  for(const file of map.values()){
    const asset=visible.get(file.name);
    if(asset?.state==="uploaded")continue;
    const current=await refresh();
    if(asset)await api.removeStarter(asset.id);
    await api.upload(current,file);
  }
  await refresh();visible=await check();
  if(visible.size!==map.size||[...visible.values()].some(a=>a.state!=="uploaded"))throw Error("Incomplete public inventory");
  const previous=tag.includes("-")?null:await api.latest();
  const stableParts=value=>/^v\d+\.\d+\.\d+$/.test(value)?value.slice(1).split(".").map(BigInt):[];
  const next=stableParts(tag), old=stableParts(previous?.tag_name);
  const different=next.findIndex((n,i)=>n!==old[i]);
  const promote=next.length===3 && (!previous || previous.id===id ||
    (old.length===3 && different!==-1 && next[different]>old[different]));
  await api.finish(id,{body:page(pageState.notes,key,"complete",id),make_latest:promote?"true":"false"});
  return id;
}

export function githubApi(repository,token,dir){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!token)throw Error("Missing GitHub Actions identity");
  const root="https://api.github.com/repos/"+repository;
  const headers={Authorization:"Bearer "+token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"studio-release-workflow"};
  async function json(route,method="GET",data,allowMissing=false){
    const response=await fetch(root+route,{method,headers:{...headers,"Content-Type":"application/json"},
      redirect:"error",body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(60000)});
    if(response.status===404&&allowMissing)return null;
    if(!response.ok)throw Error(method+" "+route+": GitHub "+response.status);
    return response.status===204?null:response.json();
  }
  return {
    async tagCommit(tag){
      let object=(await json("/git/ref/tags/"+encodeURIComponent(tag))).object;
      for(let i=0;i<8&&object.type==="tag";i++)object=(await json("/git/tags/"+object.sha)).object;
      if(object.type!=="commit")throw Error("Tag does not identify a commit");
      return object.sha;
    },
    byTag:tag=>json("/releases/tags/"+encodeURIComponent(tag),"GET",undefined,true),
    latest:()=>json("/releases/latest","GET",undefined,true),
    create:data=>json("/releases","POST",data),
    async assets(id){
      const all=[];
      for(let p=1;;p++){
        const batch=await json("/releases/"+id+"/assets?per_page=100&page="+p);
        all.push(...batch);if(batch.length<100)return all;
      }
    },
    async upload(release,file){
      const endpoint="https://uploads.github.com/repos/"+repository+"/releases/"+release.id+"/assets";
      if(release.upload_url?.split("{")[0]!==endpoint)throw Error("Unexpected asset destination");
      const stream=createReadStream(join(dir,file.name));
      try{
        const response=await fetch(endpoint+"?name="+encodeURIComponent(file.name),{method:"POST",redirect:"error",
          headers:{...headers,"Content-Length":String(file.size),"Content-Type":"application/octet-stream"},
          body:stream,duplex:"half",signal:AbortSignal.timeout(15*60*1000)});
        if(response.status!==201)throw Error("GitHub upload returned "+response.status+"; rerun failed publishing job");
        await response.arrayBuffer();
      }finally{stream.destroy();}
    },
    removeStarter:id=>json("/releases/assets/"+id,"DELETE"),
    bind:(id,data)=>json("/releases/"+id,"PATCH",data),
    finish:(id,data)=>json("/releases/"+id,"PATCH",data),
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [dir,inventory,source]=process.argv.slice(2);
  const {GITHUB_REPOSITORY:repository,RELEASE_TAG:tag,RELEASE_SHA:sha,GITHUB_RUN_ID:run,GH_TOKEN:token}=process.env;
  const id=await publishVerified(githubApi(repository,token,dir),{repository,tag,sha,run,
    notes:(await readFile(source,"utf8")).trimEnd(),files:JSON.parse(await readFile(inventory,"utf8"))});
  console.log("Verified public Release ID "+id+" for "+tag);
}
