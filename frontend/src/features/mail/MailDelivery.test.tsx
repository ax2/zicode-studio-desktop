import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { MailDelivery } from "./MailDelivery";
import type { Invoke } from "./index";

const draft = { id: "draft", revision: 4, recipient: "receiver@example.test", subject: "Saved", body: "Synthetic" };
const receipt = { kind: "delivery", accountId: "sample", draftId: draft.id, revision: draft.revision };
afterEach(cleanup);

function show(invoke: Invoke, provider: "gmail" | "alibaba") {
  setLocale("en");
  return render(<MailDelivery invoke={invoke} provider={provider} id="sample" address="sender@example.test" draft={draft} configured />);
}

it.each([["gmail", null], ["alibaba", { status: null }]] as const)(
  "checks the local %s record again after a failed initial read without sending",
  async (provider, emptyReceipt) => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error("local record is busy")).mockResolvedValueOnce(emptyReceipt);
    show(invoke as Invoke, provider);
    await screen.findByRole("alert");
    const review = screen.getByRole("button", { name: "Review before sending" }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check local delivery status" }));
    await waitFor(() => expect(review.disabled).toBe(false));
    expect(invoke.mock.calls).toEqual([[receipt], [receipt]]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm and send email" })).toBeNull();
  },
);

it("keeps an ambiguous Gmail send locked when the journal is empty and only rereads it on request", async () => {
  const replies = [null, null, null, { status: "accepted" }];
  const invoke = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "delivery") return replies.shift();
    if (request.kind === "send") throw new Error("the desktop reply was interrupted");
    throw new Error("Unexpected operation");
  });
  show(invoke as Invoke, "gmail");
  const review = screen.getByRole("button", { name: "Review before sending" }) as HTMLButtonElement;
  await waitFor(() => expect(review.disabled).toBe(false));
  fireEvent.click(review);
  fireEvent.click(screen.getByRole("button", { name: "Confirm and send email" }));
  await screen.findByText(/Delivery is unknown/);
  expect(screen.queryByRole("button", { name: "Review before sending" })).toBeNull();
  const check = screen.getByRole("button", { name: "Check local delivery status" }) as HTMLButtonElement;
  fireEvent.click(check);
  await waitFor(() => expect(check.disabled).toBe(false));
  expect(screen.getByText(/Delivery is unknown/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review before sending" })).toBeNull();
  fireEvent.click(check);
  await screen.findByText("The mail server accepted this message.");
  expect(invoke.mock.calls).toEqual([[receipt], [
    { kind: "send", accountId: "sample", draftId: draft.id, revision: draft.revision, confirmed: true },
  ], [receipt], [receipt], [receipt]]);
});

it("retains permission to review after a known preflight rejection with no local record", async () => {
  const invoke = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "delivery") return null;
    throw new Error("gmail_permission_denied");
  });
  show(invoke as Invoke, "gmail");
  const review = screen.getByRole("button", { name: "Review before sending" }) as HTMLButtonElement;
  await waitFor(() => expect(review.disabled).toBe(false));
  fireEvent.click(review);
  fireEvent.click(screen.getByRole("button", { name: "Confirm and send email" }));
  await screen.findByRole("alert");
  expect(review.disabled).toBe(false);
  expect(screen.queryByText(/Delivery is unknown/)).toBeNull();
  expect(invoke.mock.calls.filter(([request]) => request.kind === "send")).toHaveLength(1);
});
