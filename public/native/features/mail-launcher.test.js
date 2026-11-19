import { createElement } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale, t } from "../../i18n.js";
import { BuiltinPluginRegistry } from "../plugins/plugin-registry.js";
import { applicationDirectory } from "../plugins/tool-navigation.js";
import { ToolCenterApp } from "../../../frontend/src/features/toolCenter/ToolCenterApp";
import { emptyAccess } from "../../../frontend/src/features/commandPalette/tool-access";

afterEach(()=>{cleanup();setLocale("en")});
it.each([["zh-CN","邮箱"],["en","Gmail"]])("opens and pins built-in mail from tool search (%s)",async(locale,query)=>{
  setLocale(locale);
  const open=vi.fn(),scope={sceneId:"programming", workspaceId:"fixture"};
  const entries=applicationDirectory(new BuiltinPluginRegistry().list(),()=>true,t,open);
  const accessStore={read:async()=>emptyAccess(),mutate:vi.fn(async()=>({...emptyAccess(),favorites:["com.zicode.mail:open"]}))};
  const view=render(createElement(ToolCenterApp,{entries,scope,accessStore,onOpen:entry=>entry.action(),onManage:vi.fn(),onCommands:vi.fn()}));
  fireEvent.change(view.getByRole("searchbox"),{target:{value:query}});
  const title=await view.findByText(t("Mail"),{selector:"h2"});
  const card=within(title.closest("article"));
  fireEvent.click(card.getByRole("button",{name:t("Open")}));
  expect(open).toHaveBeenCalledWith("com.zicode.mail");
  fireEvent.click(card.getByRole("button",{name:t("Favorite")+": "+t("Mail")}));
  expect(accessStore.mutate).toHaveBeenCalledWith(scope,{kind:"favoriteSet",id:"com.zicode.mail:open",enabled:true});
});
