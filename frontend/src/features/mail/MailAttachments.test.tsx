import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Invoke } from "./index";
import { setLocale } from "../../shared/i18n";
import { MailAttachments } from "./MailAttachments";

afterEach(cleanup);
it("requests only the selected attachment and preserves its source account, message and epoch", async () => {
  setLocale("en");
  const items=[{id:0,name:"first.bin",size:32},{id:1,name:"second.bin",size:17}];
  const invoke=vi.fn().mockResolvedValueOnce({saved:false}).mockResolvedValueOnce({saved:true});
  const view=render(<MailAttachments items={items} invoke={invoke as Invoke} message={{accountId:"ali",uidValidity:7,uid:42}}/>);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Download attachment second.bin"}));
  await screen.findByText("Download canceled.");
  expect(invoke).toHaveBeenLastCalledWith({kind:"downloadAttachment",accountId:"ali",uidValidity:7,uid:42,part:1});
  view.rerender(<MailAttachments key="gmail" items={items} invoke={invoke as Invoke} message={{accountId:"gmail",id:"42"}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Download attachment first.bin"}));
  await screen.findByText("Attachment saved.");
  expect(invoke).toHaveBeenLastCalledWith({kind:"downloadAttachment",accountId:"gmail",id:"42",part:0});
});
