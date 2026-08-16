export interface SlashCommand {
  name?: string;
  description?: string;
  type?: string;
  source?: string;
  scope?: string;
  command?: string;
  capabilityState?: string;
}

export interface SlashMenuState {
  open: boolean;
  query: string;
  matches: SlashCommand[];
  selectedIndex: number;
}

export const EMPTY_SLASH_STATE: SlashMenuState = {
  open: false,
  query: "",
  matches: [],
  selectedIndex: 0,
};

export function titleCaseCommandName(name: string | undefined): string {
  return String(name ?? "")
    .replace(/^\//, "")
    .replace(/^skill:/, "")
    .split(/[-_:\s/]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function activeSlashQuery(input: {
  value: string;
  selectionStart: number | null;
}): { query: string; end: number } | null {
  const cursor = input.selectionStart ?? input.value.length;
  const beforeCursor = input.value.slice(0, cursor);
  const match = beforeCursor.match(/^\/([^\s/]*)$/);
  if (!match) return null;
  return { query: match[1].toLowerCase(), end: cursor };
}

export function commandInvocation(command: Partial<SlashCommand>): string {
  const name = command?.name ?? command?.command ?? "";
  if (!name) return "";
  return name.startsWith("/") ? name : `/${name}`;
}

export function isSkillCommand(command: Partial<SlashCommand>): boolean {
  return command.type === "skill" || command.source === "skill";
}

export function scopeLabel(scope?: string): string {
  if (scope === "project") return "Project";
  if (scope === "temporary") return "Temporary";
  if (scope === "picot") return "ZiCode Studio Desktop";
  return "Personal";
}

export function typeLabel(command: Partial<SlashCommand>): string {
  if (command.type === "skill" || command.source === "skill") return "Skill";
  if (command.type === "prompt" || command.source === "prompt") return "Prompt";
  if (command.type === "builtin") return "ZiCode Studio Desktop";
  return "Command";
}

export function normalizeCommands(
  commands: Iterable<Partial<SlashCommand>>,
): SlashCommand[] {
  return Array.from(commands ?? [])
    .filter((command) => isSkillCommand(command) || command.type === "builtin")
    .map((command) => ({ ...command, command: commandInvocation(command) }))
    .filter((command) => command.command && command.capabilityState !== "disabled");
}

export function commandMatches(command: SlashCommand, query: string): boolean {
  if (!query) return true;
  return [
    command.name,
    command.command,
    command.description,
    titleCaseCommandName(command.name),
    typeLabel(command),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

export function computeSlashMatches(
  input: { value: string; selectionStart: number | null },
  commands: Iterable<Partial<SlashCommand>>,
): { query: string; matches: SlashCommand[] } | null {
  const slash = activeSlashQuery(input);
  if (!slash) return null;
  return {
    query: slash.query,
    matches: normalizeCommands(commands).filter((command) =>
      commandMatches(command, slash.query),
    ),
  };
}
