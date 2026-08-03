export function setupCommandPalette({
  button,
  palette,
  overlay,
  list,
  commands,
  onError = console.error,
} = {}) {
  if (!button || !palette || !overlay || !list) return { open() {}, close() {} };

  const commandItems = () => (typeof commands === "function" ? commands() : commands) ?? [];

  function close({ restoreFocus = true } = {}) {
    palette.classList.add("hidden");
    overlay.classList.add("hidden");
    if (restoreFocus) button.focus();
  }

  function runCommand(command) {
    close({ restoreFocus: false });
    try {
      const result = command.action?.();
      if (result && typeof result.catch === "function") result.catch(onError);
    } catch (error) {
      onError(error);
    }
  }

  function renderCommand(command) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "command-item";
    item.disabled = Boolean(command.disabled);
    item.innerHTML = `
      <span class="command-icon"></span>
      <span class="command-copy">
        <span class="command-label"></span>
        <span class="command-desc"></span>
      </span>`;
    item.querySelector(".command-icon").textContent = command.icon ?? "⌘";
    item.querySelector(".command-label").textContent = command.label ?? "Command";
    item.querySelector(".command-desc").textContent = command.desc ?? "";
    item.addEventListener("click", () => runCommand(command));
    return item;
  }

  function open() {
    list.innerHTML = "";
    for (const command of commandItems()) list.appendChild(renderCommand(command));
    palette.classList.remove("hidden");
    overlay.classList.remove("hidden");
    list.querySelector(".command-item:not(:disabled)")?.focus();
  }

  button.addEventListener("click", open);
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (palette.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...palette.querySelectorAll("button:not(:disabled), input, [href], [tabindex]")]
      .filter((element) => element.getAttribute("tabindex") !== "-1");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !palette.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return { open, close };
}
