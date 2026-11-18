import type { CapabilityProfile, GenerationInput } from "./generation-types";
import type { StyleInput } from "./style-presets";
export type ImageSettings = {
  baseUrl: string;
  model: string;
  requiresKey: boolean;
  size: string;
  quality: string;
  capabilityProfile?: CapabilityProfile;
};
export type OutfitInput = {
  person: number | null;
  clothing: number | null;
  description: string;
  style?: StyleInput;
  generation?: GenerationInput;
};
export type OutfitPlan = {
  workflow?: "outfit" | "style" | "text-to-image" | "image-to-image";
  libraryId: string;
  digest: string;
  settings: ImageSettings;
  input: OutfitInput;
  prompt: string;
  references: { assetId: number; name: string; sha256: string }[];
};
export type CreationRequest = (action: Record<string, unknown>) => Promise<unknown>;
export function outfitError(reason: unknown) {
  const code = String(reason);
  if (code.includes("model_profile_name_invalid")) return "Enter a model name of 1–80 characters without control characters.";
  if (code.includes("model_profile_limit")) return "You can save up to 32 image model configurations. Remove an unused entry first.";
  if (code.includes("model_profile_unavailable")) return "This saved model is unavailable. Reload the saved model list.";
  if (code.includes("parameter_unsupported"))
    return "The selected parameters are not supported by this model configuration. Review the image options.";
  if (code.includes("quota_exhausted"))
    return "The image service has no available quota. This request was rejected and will not retry automatically. After restoring your quota, review and submit a new plan.";
  if (code.includes("rate_limited"))
    return "The image service is temporarily rate limited. No automatic retry will occur. Wait before reviewing a new plan.";
  if (code.includes("auth_failed"))
    return "The image service rejected authentication or access. Check the API key and model permissions.";
  if (code.includes("provider_rejected"))
    return "The provider rejected this request. Check your model settings before reviewing another plan.";
  if (code.includes("existing_unknown"))
    return "This plan already has an unknown result. Open saved tasks to check it before making a new request.";
  if (code.includes("credential"))
    return "Configure an API key for this image endpoint before generating.";
  if (code.includes("plan_changed") || code.includes("source_changed"))
    return "The image or model settings changed. Review a new plan.";
  if (code.includes("managed_input_required"))
    return "Choose a locally stored image or add a copy of the reference image.";
  if (code.includes("busy"))
    return "Another image task is using this library. Refresh its status before trying again.";
  return "The image action could not be completed. Check the saved task before generating again.";
}
