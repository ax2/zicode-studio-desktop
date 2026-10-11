import { t } from "i18n";

// Values are supplied explicitly, never inferred from schema defaults or user history.
export function showTransferInputs({ panel, target, inputs = {}, onPreview, onCancel, onChooseReceiver }) {
  const form = document.createElement("form");
  form.className = "plugin-transfer-inputs";
  const heading = document.createElement("strong");
  heading.textContent = t("Complete receiver inputs");
  const receiver = document.createElement("p");
  receiver.textContent = t("{title} · {plugin} · field {field}")
    .replace("{title}", target.title).replace("{plugin}", target.pluginId).replace("{field}", target.field);
  form.append(heading, receiver);
  const controls = [];
  for (const name of target.requiredInputs) {
    const label = document.createElement("label");
    label.textContent = name;
    const input = document.createElement("textarea");
    input.className = "ui-textarea";
    input.setAttribute("aria-label", name);
    input.maxLength = 8192;
    input.value = inputs[name] ?? "";
    label.append(input);
    form.append(label);
    controls.push([name, input]);
  }
  const preview = document.createElement("button");
  preview.type = "submit";
  preview.className = "ui-button";
  preview.textContent = t("Preview all inputs");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ui-button";
  cancel.textContent = t("Cancel transfer");
  cancel.addEventListener("click", onCancel);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    preview.disabled = true;
    onPreview(Object.fromEntries(controls.map(([name, input]) => [name, input.value])));
  });
  form.append(preview, cancel);
  if (onChooseReceiver) {
    const chooseReceiver = document.createElement("button");
    chooseReceiver.type = "button";
    chooseReceiver.className = "ui-button";
    chooseReceiver.textContent = t("Change receiver");
    chooseReceiver.addEventListener("click", onChooseReceiver);
    form.append(chooseReceiver);
  }
  panel.replaceChildren(form);
  controls[0]?.[1].focus();
}

export function transferInputsPreview(inputs = {}) {
  const container = document.createElement("div");
  for (const [name, value] of Object.entries(inputs)) {
    const label = document.createElement("strong");
    label.textContent = name;
    const text = document.createElement("pre");
    text.textContent = value;
    text.tabIndex = 0;
    container.append(label, text);
  }
  return container;
}
