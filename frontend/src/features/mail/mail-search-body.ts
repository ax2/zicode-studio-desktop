import { mailError } from "./AlibabaInbox";
import { gmailError } from "./GmailInbox";
import type { Attachment, MessageRef } from "./MailAttachments";
import type { Draft, Invoke } from "./index";

export type SearchMailBody = {
  text: string | null;
  html?: string | null;
  attachments?: Attachment[];
  bodyLimited?: boolean;
};

type SearchMessage = { account: string; provider: string; id: string; epoch: number | null; folder?: string };
type SearchBodyAccess = {
  invoke: Invoke;
  message: MessageRef;
  read(download: boolean): Promise<SearchMailBody | null>;
  replyDraft?(): Promise<Draft>;
  error(reason: unknown): string;
};

export function searchBodyAccess(hit: SearchMessage, gmail?: Invoke, alibaba?: Invoke): SearchBodyAccess | undefined {
  if (hit.provider === "gmail" && gmail && hit.id) {
    const message = { accountId: hit.account, id: hit.id };
    return {
      invoke: gmail, message, error: gmailError,
      replyDraft: () => gmail<Draft>({ kind: "replyDraft", ...message }),
      async read(download) {
        const body = await gmail<(Omit<SearchMailBody, "text"> & { plainText: string | null }) | null>({
          kind: download ? "read" : "cachedBody", ...message,
        });
        return body ? { text: body.plainText, html: body.html, attachments: body.attachments } : null;
      },
    };
  }
  const uid = Number(hit.id);
  if (hit.provider !== "alibaba" || !alibaba || !Number.isSafeInteger(uid) || uid <= 0 ||
      hit.epoch === null || !Number.isSafeInteger(hit.epoch) || hit.epoch <= 0) return undefined;
  const message = { accountId: hit.account, ...(hit.folder && { folder: hit.folder }), uidValidity: hit.epoch, uid };
  return {
    invoke: alibaba, message, error: mailError,
    replyDraft: () => alibaba<Draft>({ kind: "replyDraft", ...message }),
    async read(download) {
      try {
        return await alibaba<SearchMailBody>({ kind: download ? "read" : "cachedBody", ...message });
      } catch (reason) {
        if (!download && String(reason).includes("mail_cache_empty")) return null;
        throw reason;
      }
    },
  };
}
