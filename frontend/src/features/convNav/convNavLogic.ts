export const MAX_NAV_HEIGHT = 560;

export function tooltipUserPreview(
  element: HTMLElement | null | undefined,
): string {
  return element?.textContent?.trim().slice(0, 120) ?? "";
}

export function tooltipAssistantPreview(
  element: HTMLElement | null | undefined,
): string {
  return (
    element?.textContent?.trim().replace(/\s+/g, " ").slice(0, 180) ?? ""
  );
}

export function gaussianWidth(distance: number): number {
  return Math.round(10 + 10 * Math.exp(-(distance * distance) / (2 * 3 * 3)));
}

export function scrollBehavior(
  prefersReducedMotion: boolean,
  isLongJump: boolean,
): "instant" | "smooth" {
  return prefersReducedMotion || isLongJump ? "instant" : "smooth";
}
