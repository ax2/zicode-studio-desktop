/**
 * Parse the model's memory-extract answer into entry strings. The skill
 * instructs the model to output a bare JSON array, but tolerate fenced code
 * blocks and stray prose around it.
 */
export function parseMemoryExtractAnswer(text) {
  const source = String(text ?? "").trim();
  if (!source) return [];
  const jsonCandidates = [
    ...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/g),
  ].map((match) => match[1].trim());
  jsonCandidates.push(source);
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry ?? "").trim())
          .filter((entry) => entry.length > 0)
          .slice(0, 20);
      }
    } catch {
      // Try the next candidate (or the raw source).
    }
  }
  // Fallback: lines that look like list items.
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length >= 2)
    .slice(0, 20);
}

/**
 * Merge new entries into the existing list, dropping exact duplicates and
 * entries already covered by a similar text (case-insensitive containment).
 */
export function mergeMemoryEntries(existing, incoming) {
  const known = new Set(
    (existing ?? [])
      .map((entry) => String(entry?.text ?? entry ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const merged = [...(existing ?? [])];
  for (const raw of incoming ?? []) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (known.has(lower)) continue;
    if ([...known].some((knownText) => knownText.includes(lower) || lower.includes(knownText))) {
      continue;
    }
    merged.push({
      id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      updatedAt: new Date().toISOString(),
    });
    known.add(lower);
  }
  return merged;
}
