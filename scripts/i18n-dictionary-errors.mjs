function placeholders(text) {
  return [...new Set(Array.from(text.matchAll(/\{([a-zA-Z_]\w*)\}/g), match => match[1]))].sort().join(", ");
}

export function dictionaryErrors(domains) {
  const owners = new Map();
  const errors = [];
  for (const [domain, entries] of Object.entries(domains)) {
    for (const [source, translation] of Object.entries(entries)) {
      const location = `zh-CN/${domain}: ${source}`;
      if (owners.has(source)) errors.push(`${location} also appears in zh-CN/${owners.get(source)}`);
      owners.set(source, domain);
      if (typeof translation !== "string" || !translation.trim() || source.trim() === translation.trim()) {
        errors.push(`${location} needs a translation`);
      } else if (placeholders(source) !== placeholders(translation)) {
        errors.push(`${location} has different placeholders in its translation`);
      }
    }
  }
  return errors;
}
