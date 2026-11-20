import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";

export interface AnimationReviewActions {
  confirm: (token: string) => Promise<void>;
  cancel: (token: string) => Promise<unknown>;
}

export function useAnimationReview<T>(
  actions: AnimationReviewActions,
  read: (response: unknown) => { token: string; details: T } | undefined,
  reviewError: string,
  submitError: string,
) {
  const [review, setReview] = useState<T>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const ticket = useRef<{ token: string; cancel: AnimationReviewActions["cancel"] }>(undefined);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = ticket.current;
      ticket.current = undefined;
      if (current) void current.cancel(current.token).catch(() => {});
    };
  }, []);

  async function run(work: () => Promise<void>, message: string) {
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch {
      if (mounted.current) setError(t(message));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function plan(request: () => Promise<unknown>) {
    if (pending.current || ticket.current) return;
    await run(async () => {
      const response = await request();
      const next = read(response);
      if (!next) return;
      if (!mounted.current) {
        await actions.cancel(next.token);
        return;
      }
      ticket.current = { token: next.token, cancel: actions.cancel };
      setReview(next.details);
    }, reviewError);
  }

  async function finish(confirm: boolean) {
    const current = ticket.current;
    if (pending.current || !current) return;
    ticket.current = undefined;
    setReview(undefined);
    await run(async () => {
      if (confirm) await actions.confirm(current.token);
      else await current.cancel(current.token);
    }, submitError);
  }

  return { review, busy, error, plan, finish };
}
