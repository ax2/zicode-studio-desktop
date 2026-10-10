export function smokeRuntimeEnvironment(directory, source = process.env) {
  const environment = Object.fromEntries(Object.entries(source).filter(([key]) =>
    ["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "lang", "lc_all"].includes(key.toLowerCase()),
  ));
  return { ...environment, HOME: directory, USERPROFILE: directory, PI_CODING_AGENT_DIR: directory };
}
