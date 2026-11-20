export function imageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number };
export function decodeResourceImage(bytes: Uint8Array, mime: string, isCurrent: () => boolean): Promise<{
  kind: "image"; blob: Blob; width: number; height: number;
}>;
