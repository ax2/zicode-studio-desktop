import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [current, archived] = readFileSync(
  new URL("../tests/fixtures/devtools-9c17-locations.txt", import.meta.url), "utf8",
).split(/\r?\n/u);

export function devtools9c17BundleRoot(checkout) {
  const preferred = join(checkout, current);
  const legacy = join(checkout, archived);
  return !existsSync(preferred) && existsSync(legacy) ? legacy : preferred;
}

// Preserve the published audit command and leave explicit external providers alone.
export function resolveDevtoolsProviderRoot(checkout, input) {
  const provider = resolve(input);
  if (provider === resolve(checkout, archived) && !existsSync(provider)) {
    return resolve(devtools9c17BundleRoot(checkout));
  }
  return provider;
}
