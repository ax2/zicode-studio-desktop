import { useEffect, useState } from "react";
import { emptyAccess, type ToolAccessMutation, type ToolAccessScope, type ToolAccessStore } from "./tool-access";

export function useToolAccess(store?: ToolAccessStore, scope?: ToolAccessScope) {
  const [state, setState] = useState(emptyAccess);
  const [loading, setLoading] = useState(Boolean(store && scope));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is an explicit retry generation after a failed read.
  useEffect(() => {
    let current = true;
    setState(emptyAccess());
    setError(false);
    if (!store || !scope) { setLoading(false); return; }
    setLoading(true);
    void store.read(scope).then(value => {
      if (current) setState(value);
    }).catch(() => {
      if (current) setError(true);
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
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
