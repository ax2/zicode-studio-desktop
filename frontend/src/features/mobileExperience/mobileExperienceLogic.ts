// @ts-expect-error plain JS module without type declarations (public/native/)
import { isLoopbackHost } from "../../../../public/native/features/remote-auth.js";

export function isIosDevice(
  navigatorRef: { userAgent?: string; platform?: string; maxTouchPoints?: number } = globalThis
    .navigator,
): boolean {
  const userAgent = navigatorRef?.userAgent || "";
  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigatorRef?.platform === "MacIntel" && Number(navigatorRef?.maxTouchPoints) > 1)
  );
}

export function canUseRemotePwa(
  locationRef: { protocol?: string; hostname?: string } = globalThis.location,
): boolean {
  return locationRef?.protocol === "https:" && !isLoopbackHost(locationRef?.hostname);
}

export function isStandalone(windowRef: unknown): boolean {
  const ref = windowRef as {
    matchMedia?(query: string): { matches: boolean };
    navigator?: { standalone?: boolean };
  };
  return (
    ref.matchMedia?.("(display-mode: standalone)")?.matches ||
    ref.navigator?.standalone === true
  );
}
