// @ts-expect-error fixed output table is shared with the trusted JavaScript shell
import { isBinaryOutput, outputExtension } from "../../../../public/native/plugins/plugin-output-formats.js";

export function savedOutputExtension(mime: string | undefined): string | undefined {
  return mime ? (outputExtension(mime) as string | undefined) : undefined;
}

export function isBinarySavedOutput(mime: string): boolean {
  return isBinaryOutput(mime) as boolean;
}
