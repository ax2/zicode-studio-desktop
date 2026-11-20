import { t } from "../../i18n.js";

export function showBrowserProfiles(profiles, onOpen, onClose) {
  const dialog=document.createElement("dialog");
  dialog.className="browser-tab-search-dialog ui-panel";
  dialog.setAttribute("aria-label",t("Browser profiles"));
  const title=document.createElement("h2");title.textContent=t("Browser profiles");
  const form=document.createElement("form");form.className="browser-tab-group-form";
  const select=document.createElement("select");select.className="ui-input";
  select.setAttribute("aria-label",t("Browser profiles"));
  select.add(new Option(t("Default browser profile"),""));
  for(const profile of profiles)select.add(new Option(profile.name,profile.id));
  select.add(new Option(t("Create browser profile"),"new"));
  const input=document.createElement("input");input.className="ui-input";
  input.placeholder=t("Browser profile name");input.setAttribute("aria-label",input.placeholder);input.maxLength=64;input.hidden=true;
  select.addEventListener("change",()=>{input.hidden=select.value!=="new";input.required=!input.hidden;if(!input.hidden)input.focus()});
  const error=document.createElement("p");error.setAttribute("role","alert");
  const submit=document.createElement("button");submit.className="ui-button ui-button--primary";submit.textContent=t("Open in new window");
  const close=document.createElement("button");close.className="ui-button ui-button--secondary";close.type="button";close.textContent=t("Cancel");close.onclick=()=>dialog.close();
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(submit.disabled)return;
    submit.disabled=true;
    try{await onOpen(select.value==="new"?{action:"createProfile",profileName:input.value.trim()}:{action:"openProfile",profileId:select.value||null});dialog.close()}
    catch(cause){error.textContent=t(String(cause.message??cause))}
    finally{submit.disabled=false}
  });
  const actions=document.createElement("div");actions.append(close,submit);
  form.append(select,input,actions,error);dialog.append(title,form);
  dialog.addEventListener("close",()=>{dialog.remove();onClose()},{once:true});
  document.body.append(dialog);dialog.showModal();select.focus();return dialog;
}
