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

export const gameAssetTemplates = [
  {
    id: "character",
    title: "Game character",
    brief: "Create a single game character in a neutral full-body pose. Give the character a clear silhouette and leave space around the figure.",
  },
  {
    id: "prop",
    title: "Game prop",
    brief: "Create a single game prop, centered in a three-quarter view. Make its shape and material easy to recognize at small sizes.",
  },
  {
    id: "scene",
    title: "Game scene",
    brief: "Create a game environment with a clear focal point and readable foreground, middle ground, and background.",
  },
  {
    id: "icon",
    title: "Game UI icon",
    brief: "Create a single game UI icon with a simple silhouette. Keep it recognizable at small sizes and avoid lettering.",
  },
] as const;
export type GameAssetTemplateId = (typeof gameAssetTemplates)[number]["id"];
