/** Read normalization must never invent a provider or mutate its configuration. */
export function modelChannelDocument(parsed: unknown): {
  providers: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
} {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("models.json must be a JSON object");
  const document = parsed as Record<string, unknown>;
  const providers = document.providers;
  if (
    providers !== undefined &&
    (!providers || typeof providers !== "object" || Array.isArray(providers))
  )
    throw new Error("models.json providers must be an object");
  for (const config of Object.values(providers ?? {})) {
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw new Error("Model channel must be an object");
  }
  return { ...document, providers: (providers ?? {}) as Record<string, Record<string, unknown>> };
}

/** Matches the provider environment names prepared by the native runtime. */
export function providerKeyReference(provider: string): string {
  return `$${provider.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_API_KEY`;
}
