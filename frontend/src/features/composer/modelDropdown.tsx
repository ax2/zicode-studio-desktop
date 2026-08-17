import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create, type StoreApi, type UseBoundStore } from "zustand";
// @ts-expect-error plain JS module without type declarations
import { findLowestCostModel, formatModelPricing } from "../../../../public/native/models/model-routing.js";
import { t } from "../../shared/i18n";
import { isImeComposing } from "../../shared/ime";

export interface ModelLike {
  id: string;
  name?: string;
  provider?: string;
  contextWindow?: number;
}

export interface ModelDropdownSnapshot {
  models: ModelLike[];
  loading: boolean;
  error: string;
  currentModelId: string | null;
  currentContextWindow: number;
}

export interface ModelDropdownCallbacks {
  onSelect(model: ModelLike): void;
  onOpenSettings(): void;
  onRetry(): void;
  onClose(): void;
}

export function formatModelName(model: ModelLike | string): string {
  const raw = typeof model === "string" ? model : model?.name || model?.id || "";
  return raw.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export function getModelSearchText(model: ModelLike): string {
  return [model.name, model.id, model.provider].filter(Boolean).join(" ").toLowerCase();
}

interface ModelMenuState {
  snapshot: ModelDropdownSnapshot;
  filter: string;
  selectedIndex: number;
  setFilter(filter: string): void;
  setSelectedIndex(index: number): void;
}

type ModelMenuStore = UseBoundStore<StoreApi<ModelMenuState>>;

export function createModelDropdownFeed(
  container: HTMLElement,
  getState: () => ModelDropdownSnapshot,
  callbacks: ModelDropdownCallbacks,
) {
  const store = create<ModelMenuState>()((set) => ({
    snapshot: getState(),
    filter: "",
    selectedIndex: 0,
    setFilter(filter) {
      set({ filter, selectedIndex: 0 });
    },
    setSelectedIndex(index) {
      set({ selectedIndex: index });
    },
  }));
  let root: Root | null = null;

  function render() {
    store.setState({ snapshot: getState() });
    if (!root) root = createRoot(container);
    flushSync(() => {
      root?.render(
        <ModelDropdownMenu store={store} callbacks={callbacks} />,
      );
    });
  }

  return {
    render,
    focusSearch() {
      container.querySelector<HTMLInputElement>(".model-dropdown-search")?.focus();
    },
  };
}

export type ModelDropdownFeed = ReturnType<typeof createModelDropdownFeed>;

function ModelDropdownMenu({
  store,
  callbacks,
}: {
  store: ModelMenuStore;
  callbacks: ModelDropdownCallbacks;
}) {
  const snapshot = store((state) => state.snapshot);
  const filter = store((state) => state.filter);
  const selectedIndex = store((state) => state.selectedIndex);
  const setFilter = store((state) => state.setFilter);
  const setSelectedIndex = store((state) => state.setSelectedIndex);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const query = filter.trim().toLowerCase();
  const models = snapshot.models;
  const matchingModels = query
    ? models.filter((model) => getModelSearchText(model).includes(query))
    : models;
  const lowestCostModel = matchingModels.length > 0
    ? findLowestCostModel(matchingModels, {
        minimumContextWindow: Math.max(snapshot.currentContextWindow, 0),
      })
    : null;
  const lowestCostModelKey = lowestCostModel
    ? `${lowestCostModel.provider || ""}/${lowestCostModel.id}`
    : null;
  const effectiveIndex = Math.min(
    selectedIndex,
    Math.max(matchingModels.length - 1, 0),
  );

  const selectHighlighted = () => {
    const model = matchingModels[effectiveIndex];
    if (model) callbacks.onSelect(model);
  };

  return (
    <>
      <input
        ref={searchRef}
        className="model-dropdown-search"
        placeholder={t("Search models…")}
        aria-label={t("Search models…")}
        type="text"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        aria-activedescendant={
          matchingModels.length > 0
            ? `model-dropdown-item-${effectiveIndex}`
            : undefined
        }
        onKeyDown={(event) => {
          if (isImeComposing(event, composingRef.current)) return;
          if (event.key === "Escape") {
            event.stopPropagation();
            callbacks.onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex(
              matchingModels.length
                ? (effectiveIndex + 1) % matchingModels.length
                : 0,
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex(
              matchingModels.length
                ? (effectiveIndex - 1 + matchingModels.length) %
                    matchingModels.length
                : 0,
            );
          } else if (event.key === "Home") {
            event.preventDefault();
            setSelectedIndex(0);
          } else if (event.key === "End") {
            event.preventDefault();
            setSelectedIndex(Math.max(matchingModels.length - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            selectHighlighted();
          }
        }}
      />
      <div className="model-dropdown-items">
        {snapshot.loading && models.length === 0 ? (
          <div className="model-dropdown-empty">
            <div className="model-dropdown-empty-title">{t("Loading models…")}</div>
            <div>{t("Fetching models from configured channels.")}</div>
          </div>
        ) : snapshot.error && models.length === 0 ? (
          <div className="model-dropdown-empty">
            <div className="model-dropdown-empty-title">{t("Models could not be loaded")}</div>
            <div>{snapshot.error}</div>
            <button
              type="button"
              className="btn-primary model-dropdown-empty-action"
              onClick={() => callbacks.onRetry()}
            >
              {t("Retry")}
            </button>
          </div>
        ) : models.length === 0 ? (
          <div className="model-dropdown-empty">
            <div className="model-dropdown-empty-title">{t("No models available")}</div>
            <div>{t("No API keys configured. Set a key in Settings → Configuration.")}</div>
            <button
              type="button"
              className="btn-primary model-dropdown-empty-action"
              onClick={() => callbacks.onOpenSettings()}
            >
              {t("Open Settings")}
            </button>
          </div>
        ) : matchingModels.length === 0 ? (
          <div className="model-dropdown-empty">{t("No models match your search.")}</div>
        ) : (
          matchingModels.map((model, index) => (
            <button
              key={`${model.provider || ""}/${model.id}`}
              type="button"
              id={`model-dropdown-item-${index}`}
              className={`model-dropdown-item${
                index === effectiveIndex ? " selected" : ""
              }${model.id === snapshot.currentModelId ? " active" : ""}`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => callbacks.onSelect(model)}
            >
              <span className="model-dropdown-item-name">
                {formatModelName(model)}
                {model.provider && model.provider !== "anthropic" ? (
                  <span className="model-dropdown-item-provider">{model.provider}</span>
                ) : null}
                {`${model.provider || ""}/${model.id}` === lowestCostModelKey ? (
                  <span className="model-dropdown-item-recommendation">
                    {t("Lowest cost")}
                  </span>
                ) : null}
              </span>
              <span className="model-dropdown-item-ctx">
                {[
                  model.contextWindow
                    ? `${(Number(model.contextWindow) / 1000).toFixed(0)}k`
                    : "",
                  formatModelPricing(model),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
