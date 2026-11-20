import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLocale } from "../../shared/i18n";
import { type ConflictApplied, type ConflictChoice, type ConflictInvoke, type ConflictPage, type ConflictRow, type ConflictScope,
  conflictFailure, parseConflictApplied, parseConflictDetail, parseConflictPage } from "./notes-sync-conflict-state";

export function useNotesSyncConflicts(identity: ConflictScope, enabled: boolean, current: () => boolean, invoke: ConflictInvoke,
  onApplied: (result: ConflictApplied) => void) {
  const { workspaceId, sceneId, runId, revision } = identity;
  const scope = useMemo(() => ({ workspaceId, sceneId, runId, revision }), [workspaceId, sceneId, runId, revision]);
  const [pages, setPages] = useState<ConflictPage[]>([]), [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<ReadonlyMap<string, ConflictChoice>>(new Map());
  const [detail, setDetail] = useState<ConflictRow | null>(null), [detailId, setDetailId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; blocked: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState<ConflictApplied | null>(null);
  const generation = useRef(0), inFlight = useRef(false), available = useRef(enabled), active = useRef(current), done = useRef(onApplied);
  available.current = enabled; active.current = current; done.current = onApplied;
  const request = useCallback(async (fields: Record<string, unknown>, parse: (value: unknown) => unknown, accept: (value: unknown) => void) => {
    if (inFlight.current) return;
    if (!available.current || !active.current()) { setFailure(conflictFailure("notes_sync_review_changed")); setConfirming(false); return; }
    const epoch = generation.current;
    inFlight.current = true; setBusy(true); setFailure(null); setConfirming(false);
    try {
      const value = parse(await invoke("notes_sync_conflicts", { request: { ...scope, ...fields } }));
      if (generation.current === epoch && active.current()) accept(value);
    } catch (error) {
      if (generation.current === epoch) setFailure(conflictFailure(error, fields.kind === "apply" ? "apply" : "read"));
    } finally {
      if (generation.current === epoch) { inFlight.current = false; setBusy(false); }
    }
  }, [invoke, scope]);
  useEffect(() => {
    generation.current++;
    setPages([]); setPageIndex(0); setSelected(new Map()); setDetail(null); setDetailId(null);
    setFailure(null); setConfirming(false); setApplied(null);
    void request({ kind: "list", cursor: 0 }, value => parseConflictPage(value, scope, 0), value => setPages([value as ConflictPage]));
    return () => { generation.current++; inFlight.current = false; };
  }, [request, scope]);
  useEffect(() => { if (!enabled) setConfirming(false); }, [enabled]);
  const rows = pages.flatMap(page => page.rows), page = pages[pageIndex];
  const total = pages[0]?.total ?? 0, allLoaded = Boolean(page && pages.at(-1)?.nextCursor === null && rows.length === total);
  const complete = total > 0 && allLoaded && rows.every(row => row.allowedChoices.includes(selected.get(row.id) as ConflictChoice));
  const canUse = enabled && !busy && !failure?.blocked && !applied && current();

  function choose(row: ConflictRow, choice: string) {
    if (!canUse || !row.allowedChoices.includes(choice as ConflictChoice)) return;
    setSelected(previous => new Map(previous).set(row.id, choice as ConflictChoice)); setConfirming(false);
  }
  async function next() {
    if (!canUse || !page) return;
    setConfirming(false); setDetail(null); setDetailId(null);
    if (pageIndex < pages.length - 1) { setPageIndex(pageIndex + 1); return; }
    const cursor = page.nextCursor;
    if (cursor === null) return;
    await request({ kind: "list", cursor }, value => {
      const nextPage = parseConflictPage(value, scope, cursor);
      if (nextPage.total !== total || nextPage.rows.some(row => rows.some(old => old.id === row.id))) throw Error("notes_sync_review_changed");
      return nextPage;
    }, value => { setPages(previous => [...previous, value as ConflictPage]); setPageIndex(pageIndex + 1); });
  }
  function previous() {
    if (!canUse || pageIndex === 0) return;
    setPageIndex(pageIndex - 1); setDetail(null); setDetailId(null); setConfirming(false);
  }
  async function compare(row: ConflictRow) {
    if (!canUse) return;
    setDetail(null); setDetailId(row.id);
    await request({ kind: "detail", id: row.id }, value => {
      const item = parseConflictDetail(value, scope, row.id);
      if (item.kind !== row.kind || JSON.stringify(item.allowedChoices) !== JSON.stringify(row.allowedChoices)) throw Error("notes_sync_review_changed");
      return item;
    }, value => setDetail(value as ConflictRow));
  }
  async function retry() {
    if (!canUse) return;
    if (detailId) {
      const row = rows.find(row => row.id === detailId); if (row) await compare(row);
    } else if (pages.length === 0) await request({ kind: "list", cursor: 0 }, value => parseConflictPage(value, scope, 0), value => setPages([value as ConflictPage]));
    else await next();
  }
  async function apply() {
    if (!available.current || !active.current()) { setFailure(conflictFailure("notes_sync_review_changed")); setConfirming(false); return; }
    if (!canUse || !complete || !confirming) return;
    const locale = getLocale() === "zh-CN" ? "zh-CN" : "en";
    const choices = rows.map(row => ({ id: row.id, choice: selected.get(row.id) }));
    await request({ kind: "apply", confirmed: true, locale, choices }, value => parseConflictApplied(value, scope), value => {
      const result = value as ConflictApplied; setApplied(result); done.current(result);
    });
  }
  return { pages, page, pageIndex, total, rows, selected, detail, detailId, busy, failure, confirming, applied,
    complete, canUse, choose, next, previous, compare, retry, apply,
    review: () => { if (canUse && complete) setConfirming(true); }, cancelConfirmation: () => setConfirming(false) };
}
