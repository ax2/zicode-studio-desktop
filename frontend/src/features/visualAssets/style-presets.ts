// Revisions identify the starting preset; edited briefs are frozen in every plan.
export const stylePresets = [
  {
    id: "van-gogh",
    title: "Van Gogh",
    revision: 1,
    description:
      "Expressive post-impressionist painting: swirling, directional impasto brushstrokes, vivid cobalt blues and warm yellow accents, visible layered paint texture. Keep the original subject and composition recognizable.",
  },
  {
    id: "ink-wash",
    title: "Ink wash",
    revision: 1,
    description:
      "Chinese ink wash painting: expressive black ink strokes, diluted gray washes, soft ink bleeding on absorbent rice paper, generous unpainted space and restrained color. Keep the original subject and composition recognizable.",
  },
  {
    id: "watercolor",
    title: "Watercolor",
    revision: 1,
    description:
      "Transparent watercolor painting: luminous layered washes, soft wet-on-wet edges, gentle pigment granulation and visible paper texture. Keep the original subject and composition recognizable.",
  },
  { id: "custom", title: "Custom style", revision: 1, description: "" },
] as const;
export type StyleInput = {
  preset: (typeof stylePresets)[number]["id"];
  revision: number;
  strength: "subtle" | "balanced" | "bold";
  preserve: string;
};
export const defaultPreservation =
  "Keep the subject's identity, number of subjects, pose, spatial relationships and composition. Preserve meaningful objects and readable text where possible.";
export const strengthDescriptions = {
  subtle:
    "Subtle: restrained brushwork and color changes; keep fine source details where possible.",
  balanced:
    "Balanced: clearly visible style while keeping the subject and composition recognizable.",
  bold: "Bold: strong brushwork, texture and color; fine details may be simplified.",
} as const;
