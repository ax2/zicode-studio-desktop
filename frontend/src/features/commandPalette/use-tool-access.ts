import { useEffect, useState } from "react";
import { emptyAccess, type ToolAccessMutation, type ToolAccessScope, type ToolAccessStore } from "./tool-access";

function isStartupConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /host runtime is disconnected|host disconnected before|workspace is not registered/i.test(message);
}

export function useToolAccess(store?: ToolAccessStore, scope?: ToolAccessScope) {
  const [state, setState] = useState(emptyAccess);
  const [loading, setLoading] = useState(Boolean(store && scope));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is an explicit retry generation after a failed read.
  useEffect(() => {
    let current = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setState(emptyAccess());
    setError(false);
    if (!store || !scope) { setLoading(false); return; }
    setLoading(true);
    const read = (attempt: number) => {
      void store.read(scope).then(value => {
        if (!current) return;
        setState(value);
        setLoading(false);
      }).catch(reason => {
        if (!current) return;
        if (attempt < 2 && isStartupConnectionError(reason)) {
          retryTimer = setTimeout(() => { retryTimer = undefined; if (current) read(attempt + 1); }, attempt === 0 ? 250 : 1000);
          return;
        }
        setError(true);
        setLoading(false);
      });
    };
    read(0);
    return () => { current = false; if (retryTimer) clearTimeout(retryTimer); };
  }, [store, scope, reload]);

  const mutate = async (mutation: ToolAccessMutation) => {
    if (!store || !scope || loading || pending) return;
    setPending(true);
    try {
      const value = await store.mutate(scope, mutation);
      setState(value);
      setError(false);
    } catch { setError(true); }
    finally { setPending(false); }
  };
  return { state, loading, pending, error, mutate, retry: () => setReload(value => value + 1) };
}
