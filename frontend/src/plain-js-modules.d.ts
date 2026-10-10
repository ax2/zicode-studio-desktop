// Ambient declarations for plain JS modules shared through the import map.
// The runtime resolves these bare specifiers to /i18n.js and /themes.js.
declare module "i18n" {
  export function t(source: string): string;
  export function getLocale(): string;
  export function setLocale(locale: string): void;
  export function translateDocument(root?: Element): void;
  export const supportedLocales: Record<string, string>;
}

declare module "themes" {
  export function applyTheme(themeId: string): void;
  export function getCurrentTheme(): string;
  export const themes: Record<
    string,
    {
      name: Record<string, string>;
      dark: boolean;
      themeColor: string;
      vars: Record<string, string>;
    }
  >;
}
