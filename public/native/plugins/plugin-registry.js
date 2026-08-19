const STORAGE_KEY = "zicode.application-plugins.v1";

export const BUILTIN_APPLICATION_PLUGINS = Object.freeze([
  {
    id: "core.chat",
    name: "Chat",
    description: "Pi conversations, sessions, tools, and workspace context.",
    icon: "chat",
    order: 0,
    core: true,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "chat.sessions",
        title: "Sessions",
        description: "The existing session tree remains the Chat sidebar.",
      },
    ],
    commands: [],
  },
  {
    id: "com.zicode.projects",
    name: "Projects",
    description: "Persistent workspaces that connect conversations, notes, files, and artifacts.",
    icon: "projects",
    order: 50,
    // Incomplete: project create/edit/delete is not implemented yet.
    enabledByDefault: false,
    sidebarViews: [],
    commands: [{ id: "projects.open", label: "Open project overview", icon: "open" }],
  },
  {
    id: "com.zicode.tasks",
    name: "Tasks",
    description: "One place to monitor, recover, pause, and review background work.",
    icon: "tasks",
    order: 75,
    // Incomplete: no background Host Runner yet, so the task list stays empty.
    enabledByDefault: false,
    sidebarViews: [],
    commands: [{ id: "tasks.open", label: "Open task center", icon: "open" }],
  },
  {
    id: "com.zicode.notes",
    name: "Notes",
    description: "Local-first Markdown notebooks and web capture.",
    icon: "notes",
    order: 100,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "notes.notebooks",
        title: "Notebooks",
        description: "No notebooks yet",
        action: "Create notebook",
      },
      {
        id: "notes.quickAccess",
        title: "Quick access",
        items: ["All notes", "Recent", "Web clips"],
      },
      {
        id: "notes.tags",
        title: "Tags",
        description: "Tags will appear as notes are collected.",
      },
    ],
    commands: [
      { id: "notes.new", label: "New note", icon: "add", primary: true },
      { id: "notes.captureUrl", label: "Capture URL", icon: "clip" },
    ],
  },
  {
    id: "com.zicode.automation",
    name: "Automation",
    description: "Scheduled, approval-aware workflows with retries and auditable history.",
    icon: "automation",
    order: 150,
    // Incomplete: unattended execution needs a background Host Runner.
    enabledByDefault: false,
    sidebarViews: [],
    commands: [{ id: "automation.open", label: "Open automations", icon: "open" }],
  },
  {
    id: "com.zicode.finance",
    name: "Finance",
    description: "Research, screening, deterministic backtests, and paper accounts.",
    icon: "finance",
    order: 200,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "finance.research",
        title: "Research",
        items: ["Market overview", "Watchlists", "Research queue"],
      },
      {
        id: "finance.labs",
        title: "Strategy lab",
        items: ["Stock screener", "Backtests"],
      },
      {
        id: "finance.paper",
        title: "Paper trading",
        items: ["Accounts", "Orders"],
      },
    ],
    commands: [
      { id: "finance.openWorkbench", label: "Open workbench", icon: "open", primary: true },
      { id: "finance.configuration", label: "Configuration", icon: "settings" },
    ],
  },
  {
    id: "com.zicode.graph",
    name: "Knowledge Graph",
    description: "Visualize note links, backlinks, similar notes and conflicts.",
    icon: "graph",
    order: 106,
    enabledByDefault: false,
    sidebarViews: [
      {
        id: "graph.sidebar",
        title: "Graph",
        description: "Notes and their connections.",
      },
    ],
    commands: [{ id: "graph.open", label: "Open Knowledge Graph", icon: "open" }],
  },
  {
    id: "com.zicode.translate",
    name: "Translate",
    description: "Translate text between languages using the configured model.",
    icon: "translate",
    order: 107,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "translate.sidebar",
        title: "Translate",
        description: "Translate text between languages.",
      },
    ],
    commands: [{ id: "translate.open", label: "Open Translation", icon: "open" }],
  },
  {
    id: "com.zicode.habits",
    name: "Habits",
    description: "Track daily habits and metrics with streaks and history.",
    icon: "habits",
    order: 108,
    enabledByDefault: false,
    sidebarViews: [
      {
        id: "habits.sidebar",
        title: "Habits",
        description: "Track your daily habits and keep a streak.",
      },
    ],
    commands: [{ id: "habits.open", label: "Open Habit Tracker", icon: "open" }],
  },
  {
    id: "com.zicode.watch",
    name: "Web Watch",
    description: "Detect when public web pages change with content hash checks.",
    icon: "watch",
    order: 109,
    enabledByDefault: false,
    sidebarViews: [
      {
        id: "watch.sidebar",
        title: "Web Watch",
        description: "Detect when public web pages change.",
      },
    ],
    commands: [{ id: "watch.open", label: "Open Web Watch", icon: "open" }],
  },
  {
    id: "com.zicode.ocr",
    name: "OCR",
    description: "Extract text from screenshots and images using the system OCR engine.",
    icon: "ocr",
    order: 110,
    enabledByDefault: false,
    sidebarViews: [
      {
        id: "ocr.sidebar",
        title: "OCR",
        description: "Extract text from screenshots and images.",
      },
    ],
    commands: [{ id: "ocr.open", label: "Open Text Extraction", icon: "open" }],
  },
  {
    id: "com.zicode.idphoto",
    name: "ID Photo",
    description: "ID photo layout: crop to templates, replace backgrounds, and arrange printable sheets.",
    icon: "idphoto",
    order: 200,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "idphoto.sidebar",
        title: "ID Photo",
        description: "Choose a template and print sheet.",
      },
    ],
    commands: [{ id: "idphoto.open", label: "Open ID Photo Layout", icon: "open" }],
  },
  {
    id: "com.zicode.imagetools",
    name: "Image Tools",
    description: "Image toolbox: resize, format/quality conversion, flip, rotate and grid concat.",
    icon: "imagetools",
    order: 250,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "imagetools.sidebar",
        title: "Image Tools",
        description: "Process or arrange images.",
      },
    ],
    commands: [{ id: "imagetools.open", label: "Open Image Tools", icon: "open" }],
  },
  {
    id: "com.zicode.clipboard",
    name: "Clipboard",
    description: "A quick capture inbox for text and URLs before you organize them.",
    icon: "clipboard",
    order: 255,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "clipboard.sidebar",
        title: "Clipboard",
        description: "Capture text and URLs before you organize them.",
      },
    ],
    commands: [{ id: "clipboard.open", label: "Open Clipboard Inbox", icon: "open" }],
  },
  {
    id: "com.zicode.documents",
    name: "Documents",
    description: "Import PDF and DOCX files as readable Markdown.",
    icon: "documents",
    order: 260,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "documents.sidebar",
        title: "Documents",
        description: "Import PDF and DOCX files.",
      },
    ],
    commands: [{ id: "documents.open", label: "Open Document Import", icon: "open" }],
  },
  {
    id: "com.zicode.artifacts",
    name: "Artifacts",
    description: "Reports, charts, files, provenance, and exports from every plugin.",
    icon: "artifacts",
    order: 300,
    enabledByDefault: true,
    sidebarViews: [
      {
        id: "artifacts.recent",
        title: "Recent",
        description: "Generated artifacts will appear here.",
      },
      {
        id: "artifacts.types",
        title: "Types",
        items: ["Reports", "Charts", "Files"],
      },
    ],
    commands: [{ id: "artifacts.export", label: "Export", icon: "export" }],
  },
  {
    id: "com.zicode.articles",
    name: "Articles",
    description: "Create and publish articles to the Astro blog and WeChat Official Account.",
    icon: "articles",
    order: 270,
    enabledByDefault: false,
    sidebarViews: [
      {
        id: "articles.posts",
        title: "Posts",
        description: "Your synced blog posts will appear here.",
      },
    ],
    commands: [{ id: "articles.open", label: "Open Article Studio", icon: "open" }],
  },
]);

export class BuiltinPluginRegistry {
  #diagnostics = [];
  #gateway;
  #hostPlugins = null;
  #listeners = new Set();
  #plugins;
  #sceneId = "programming";
  #state;
  #storage;

  constructor({
    plugins = BUILTIN_APPLICATION_PLUGINS,
    storage = globalThis.localStorage,
    hostGateway = null,
  } = {}) {
    this.#plugins = plugins.map((plugin) => structuredClone(plugin));
    this.#storage = storage;
    this.#gateway = hostGateway;
    this.#state = this.#load();
  }

  list() {
    if (this.#hostPlugins) return this.#hostPlugins.map((plugin) => structuredClone(plugin));
    return this.#plugins.map((plugin) => ({
      ...structuredClone(plugin),
      enabled: this.isEnabled(plugin.id),
      hasActivity: plugin.hasActivity !== false,
      origin: "builtIn",
      permissions: {},
    }));
  }

  get(pluginId) {
    if (this.#hostPlugins) {
      const plugin = this.#hostPlugins.find((candidate) => candidate.id === pluginId);
      return plugin ? structuredClone(plugin) : null;
    }
    const plugin = this.#plugins.find((candidate) => candidate.id === pluginId);
    if (!plugin) return null;
    return {
      ...structuredClone(plugin),
      enabled: this.isEnabled(pluginId),
      hasActivity: plugin.hasActivity !== false,
      origin: "builtIn",
      permissions: {},
    };
  }

  isEnabled(pluginId) {
    if (this.#hostPlugins) {
      return this.#hostPlugins.find((candidate) => candidate.id === pluginId)?.enabled === true;
    }
    const plugin = this.#plugins.find((candidate) => candidate.id === pluginId);
    if (!plugin) return false;
    if (plugin.core) return true;
    const saved = this.#state.enabled?.[pluginId];
    return typeof saved === "boolean" ? saved : plugin.enabledByDefault === true;
  }

  async setEnabled(pluginId, enabled) {
    const plugin = this.get(pluginId);
    if (!plugin) throw new Error(`Unknown application plugin: ${pluginId}`);
    if (plugin.core && !enabled) throw new Error(`${plugin.name} is a required core plugin`);
    if (this.isEnabled(pluginId) === enabled) return;
    if (this.#gateway) {
      await this.#gateway.setEnabled(this.#sceneId, pluginId, enabled);
      plugin.enabled = enabled;
      this.#replaceHostPlugin(plugin);
      this.#emit();
      return;
    }
    this.#state.enabled = { ...this.#state.enabled, [pluginId]: enabled };
    this.#save();
    this.#emit();
  }

  async setPermission(pluginId, permission, granted) {
    if (!this.#gateway) throw new Error("Permissions require the Plugin Host");
    const plugin = this.get(pluginId);
    if (!plugin) throw new Error(`Unknown application plugin: ${pluginId}`);
    await this.#gateway.setPermission(this.#sceneId, pluginId, permission, granted);
    plugin.permissions = { ...plugin.permissions, [permission]: granted };
    if (
      !granted &&
      plugin.permissionDetails?.required?.some((candidate) => candidate.name === permission)
    ) {
      plugin.enabled = false;
    }
    this.#replaceHostPlugin(plugin);
    this.#emit();
  }

  async setScene(sceneId) {
    this.#sceneId = sceneId || "programming";
    if (!this.#gateway) return;
    const response = await this.#gateway.list(this.#sceneId);
    this.#diagnostics = Array.isArray(response?.diagnostics) ? response.diagnostics : [];
    this.#hostPlugins = (response?.plugins ?? [])
      .map((descriptor) => this.#normalizeHostPlugin(descriptor))
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
    this.#emit();
  }

  async reload() {
    if (!this.#gateway) return;
    await this.#gateway.reload();
    await this.setScene(this.#sceneId);
  }

  async uninstall(pluginId) {
    if (!this.#gateway) throw new Error("Uninstall requires the Plugin Host");
    const plugin = this.get(pluginId);
    if (!plugin) throw new Error(`Unknown application plugin: ${pluginId}`);
    if (plugin.origin !== "developer" && plugin.origin !== "signed") {
      throw new Error("Built-in plugins cannot be uninstalled");
    }
    await this.#gateway.uninstall(pluginId);
    await this.setScene(this.#sceneId);
  }

  diagnostics() {
    return structuredClone(this.#diagnostics);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #load() {
    try {
      const parsed = JSON.parse(this.#storage?.getItem(STORAGE_KEY) ?? "{}");
      return {
        version: 1,
        enabled:
          parsed?.version === 1 && parsed.enabled && typeof parsed.enabled === "object"
            ? parsed.enabled
            : {},
      };
    } catch {
      return { version: 1, enabled: {} };
    }
  }

  #save() {
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#state));
    } catch {
      // Persistence is optional in restricted webviews and tests.
    }
  }

  #emit() {
    for (const listener of this.#listeners) listener(this.list());
  }

  #replaceHostPlugin(plugin) {
    if (!this.#hostPlugins) return;
    this.#hostPlugins = this.#hostPlugins.map((candidate) =>
      candidate.id === plugin.id ? structuredClone(plugin) : candidate,
    );
  }

  #normalizeHostPlugin(descriptor) {
    const presentation = this.#plugins.find((candidate) => candidate.id === descriptor.id);
    const contributes = descriptor.contributes ?? {};
    const activity = contributes.activities?.[0];
    const views = contributes.views ?? [];
    const commands = contributes.commands ?? [];
    return {
      ...structuredClone(presentation ?? {}),
      id: descriptor.id,
      name: descriptor.displayName || descriptor.name,
      description: descriptor.description,
      version: descriptor.version,
      publisher: descriptor.publisher,
      icon: presentation?.icon ?? "plugins",
      order: presentation?.order ?? activity?.order ?? 1000,
      hasActivity: Boolean(activity),
      core: descriptor.core === true,
      enabled: descriptor.enabled === true,
      origin: descriptor.origin,
      permissions: descriptor.permissionGrants ?? {},
      permissionDetails: descriptor.permissions ?? { required: [], optional: [] },
      publisherKeyId: descriptor.publisherKeyId ?? null,
      retainedVersions: structuredClone(descriptor.retainedVersions ?? []),
      capabilities: structuredClone(contributes.capabilities ?? []),
      views: structuredClone(views),
      sidebarViews:
        presentation?.sidebarViews ??
        views
          .filter((view) => view.location === "sidebar")
          .map((view) => ({
            id: view.id,
            title: view.title,
            description: "Plugin view",
            entry: view.entry,
          })),
      mainViews: views.filter((view) => view.location === "main").map((view) => ({ ...view })),
      commands:
        presentation?.commands ??
        commands.map((command) => ({
          id: command.id,
          label: command.title,
          icon: "command",
        })),
    };
  }
}

export function createBuiltinPluginRegistry(options) {
  return new BuiltinPluginRegistry(options);
}
