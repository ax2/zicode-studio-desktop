export function imageDimensions(bytes: Uint8Array, mime: string, unorientedPng?: boolean): { width: number; height: number };
export function decodeResourceImage(bytes: Uint8Array, mime: string, isCurrent: () => boolean, unorientedPng?: boolean): Promise<{
  kind: "image"; blob: Blob; width: number; height: number;
}>;
