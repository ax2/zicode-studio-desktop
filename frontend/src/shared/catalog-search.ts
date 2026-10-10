/** Shared matching for plugin search and the command palette.
 * Search metadata only; never index user inputs or saved document bodies.
 */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function prepareSearchQuery(query: string): string[] {
  return [...new Set(normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean))];
}

export function matchesSearchTerms(
  terms: readonly string[],
  fields: readonly (string | null | undefined)[],
): boolean {
  if (terms.length === 0) return true;
  const searchable = fields
    .filter((field): field is string => typeof field === "string")
    .map(normalizeSearchText);
  return terms.every((term) => searchable.some((field) => field.includes(term)));
}

export function matchesSearchQuery(
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  return matchesSearchTerms(prepareSearchQuery(query), fields);
}
