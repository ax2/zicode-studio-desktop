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

it.each([false, true])("reports a pending attachment and allows the same button to retry (failed: %s)", async fails => {
  setLocale("en");
  const items = [{ id: 0, name: "first.bin", size: 32 }, { id: 1, name: "second.bin", size: 17 }];
  let finish!: (value: { saved: boolean }) => void;
  let fail!: (reason: Error) => void;
  const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const invoke = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ saved: true });
  render(<MailAttachments items={items} invoke={invoke as Invoke} message={{ accountId: "gmail", id: "42" }} />);
  const first = screen.getByRole("button", { name: "Download attachment first.bin" });
  const chosen = screen.getByRole("button", { name: "Download attachment second.bin" });
  chosen.focus();
  fireEvent.click(chosen);
  expect(screen.getByRole("status").textContent).toBe("Saving attachment…");
  expect(chosen.getAttribute("aria-disabled")).toBe("true");
  expect(chosen.matches(":disabled")).toBe(false);
  expect(document.activeElement).toBe(chosen);
  fireEvent.click(chosen);
  fireEvent.click(first);
  expect(invoke).toHaveBeenCalledTimes(1);
  if (fails) fail(Error("mail_attachment_exists"));
  else finish({ saved: false });
  const outcome = fails ? "A file with that name already exists. Choose another name." : "Download canceled.";
  await screen.findByText(outcome);
  expect(chosen.hasAttribute("aria-disabled")).toBe(false);
  expect(document.activeElement).toBe(chosen);
  fireEvent.click(chosen);
  await screen.findByText("Attachment saved.");
  const request = { kind: "downloadAttachment", accountId: "gmail", id: "42", part: 1 };
  expect(invoke.mock.calls).toEqual([[request], [request]]);
});

it("preserves cached attachment details and resumes downloads after reconnection", async () => {
  setLocale("en");
  const items = [{ id: 0, name: "evidence.bin", size: 27 }];
  const invoke = vi.fn().mockResolvedValue({ saved: false });
  const props = { items, invoke: invoke as Invoke, message: { accountId: "gmail", id: "42" } };
  const view = render(<MailAttachments {...props} canDownload={false} />);
  const button = screen.getByRole("button", { name: "Download attachment evidence.bin" });
  expect(screen.getByText("evidence.bin · 27 B")).toBeTruthy();
  const hint = screen.getByText("Connect this mail account to download attachments.");
  expect(button.getAttribute("aria-describedby")).toBe(hint.id);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  button.focus();
  fireEvent.click(button);
  expect(document.activeElement).toBe(button);
  expect(invoke).not.toHaveBeenCalled();

  view.rerender(<MailAttachments {...props} canDownload />);
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  expect(button.hasAttribute("aria-describedby")).toBe(false);
  fireEvent.click(button);
  await screen.findByText("Download canceled.");
  expect(invoke).toHaveBeenCalledExactlyOnceWith({
    kind: "downloadAttachment", accountId: "gmail", id: "42", part: 0,
  });
});
