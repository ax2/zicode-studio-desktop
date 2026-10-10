import { isDirectoryApplication } from "./tool-navigation.js";

export function pluginCommandEntries(plugins, options) {
  return plugins
    .filter((plugin) => plugin.enabled && options.isAvailable(plugin))
    .flatMap((plugin) => {
      const entries = (plugin.commands ?? []).map((command) => ({
        id: `${plugin.id}:command:${command.id}`,
        icon: options.icon(command.icon),
        label: `${options.translate(plugin.name)}: ${options.translate(command.label)}`,
        desc: options.translate(plugin.description ?? ""),
        keywords: [plugin.id, plugin.publisher, command.id].filter(
          (text) => typeof text === "string",
        ),
        action: () => options.execute(command.id),
        disabled: options.isDisabled(plugin, command),
      }));
      if (
        isDirectoryApplication(plugin)
      ) {
        entries.push({
          id: `${plugin.id}:open`,
          icon: options.icon("plugins"),
          label: `${options.translate("Open")}: ${options.translate(plugin.name)}`,
          desc: options.translate(plugin.description ?? ""),
          keywords: [
            plugin.id,
            ...(typeof plugin.publisher === "string" ? [plugin.publisher] : []),
            ...(plugin.capabilities ?? []).flatMap((capability) =>
              [capability.id, capability.title].filter((text) => typeof text === "string"),
            ),
          ],
          action: () => options.openPlugin(plugin.id),
          disabled: false,
        });
      }
      return entries;
    });
}
