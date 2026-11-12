export const characterFacets = {
  identity: "Identity",
  appearance: "Appearance",
  style: "Character style",
} as const;

export type CharacterFacet = keyof typeof characterFacets;
