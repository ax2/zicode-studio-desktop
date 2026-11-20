// User-defined business order. Library management is a supporting destination.
export const creationWorkflows = [
  {
    id: "outfit",
    title: "Character outfit change",
    description: "Keep the person, create a new outfit.",
    inputs: "Person image, clothing reference or description",
    output: "Reviewed outfit image",
    priority: 1,
  },
  {
    id: "style",
    title: "Image style transfer",
    description: "Explore Van Gogh, ink wash and your own visual style.",
    inputs: "Source image and style preset",
    output: "Restyled image",
    priority: 2,
  },
  {
    id: "generate",
    title: "Generate images",
    description: "Create from text or develop an existing image.",
    inputs: "Prompt and optional reference images",
    output: "Generated images",
    priority: 3,
  },
  {
    id: "game",
    title: "Game asset creation",
    description: "Create characters, props, scenes and game icons.",
    inputs: "Asset brief, references and engine requirements",
    output: "Reviewed game assets and exports",
    priority: 4,
  },
  {
    id: "animation",
    title: "Animations and stickers",
    description: "Turn images and frames into animated expressions.",
    inputs: "Images, frames, captions and timing",
    output: "Animations and sticker packs",
    priority: 5,
  },
] as const;
export type CreationWorkflow = (typeof creationWorkflows)[number];
export type CreationWorkflowId = CreationWorkflow["id"];
