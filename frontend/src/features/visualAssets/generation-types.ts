import type { ImageSettings } from "./outfit-types";

export type CapabilityProfile = "basic-v1" | "gpt-image-v1" | "gpt-image-26-v1";
export type ImageCapabilities = {
  profile: CapabilityProfile;
  source: "built-in" | "configured" | "unlisted";
  sizes: string[];
  qualities: string[];
  formats: string[];
  backgrounds: string[];
  complexities: string[];
  compression: boolean;
};
export type GenerationOptions = {
  size?: string;
  quality?: string;
  format?: string;
  background?: string;
  complexity?: string;
  compression?: number;
};
export type GenerationInput = { mode: "text" | "image"; options: GenerationOptions };
export const basicCapabilities: ImageCapabilities = {
  profile: "basic-v1",
  source: "unlisted",
  sizes: [],
  qualities: [],
  formats: [],
  backgrounds: [],
  complexities: [],
  compression: false,
};
export function generationDefaults(settings: ImageSettings, capabilities: ImageCapabilities) {
  return {
    ...(capabilities.sizes.includes(settings.size) ? { size: settings.size } : {}),
    ...(capabilities.qualities.includes(settings.quality) ? { quality: settings.quality } : {}),
    ...(capabilities.formats.includes("png") ? { format: "png" } : {}),
  };
}
export const generationOptionLabels = {
  size: "Image size",
  quality: "Image quality",
  format: "Output image format",
  background: "Image background",
  complexity: "Image planning complexity",
  compression: "Output compression (0–100)",
};
export function generationOptionValue(value: string) {
  const labels: Record<string, string> = {
    auto: "Automatic",
    low: "Low",
    medium: "Medium",
    high: "High",
    transparent: "Transparent background",
    opaque: "Opaque background",
  };
  return labels[value] ?? value;
}
export function imageWorkflowLabel(workflow?: string) {
  if (workflow === "style") return "Image style transfer";
  if (workflow === "text-to-image") return "Text to image";
  if (workflow === "image-to-image") return "Image to image";
  return "Character outfit change";
}
