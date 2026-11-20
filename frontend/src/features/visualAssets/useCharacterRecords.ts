import { useEffect, useState } from "react";

export type CharacterRequest = (action: Record<string, unknown>) => Promise<unknown>;
export type CharacterAsset = { id: number; name: string };
export type RecordPage<Entry, Cursor> = { entries: Entry[]; next: Cursor | null };

export function useCharacterRecords<Entry, Cursor>(
  read: (cursor?: Cursor) => Promise<RecordPage<Entry, Cursor>>,
  revision = 0,
) {
  const [page, setPage] = useState<RecordPage<Entry, Cursor>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload explicitly refetches the first page.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    void read().then(
      (result) => {
        if (!current) return;
        setPage(result);
        setLoading(false);
      },
      () => {
        if (!current) return;
        setError(true);
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [read, refresh, revision]);

  async function more() {
    if (loading || page?.next == null) return;
    setLoading(true);
    setError(false);
    try {
      const next = await read(page.next);
      setPage({ entries: [...page.entries, ...next.entries], next: next.next });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return { page, loading, error, more, reload: () => setRefresh((value) => value + 1) };
}
