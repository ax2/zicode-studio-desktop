import { useEffect, useMemo } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import {
  buildGraph,
  layoutGraph,
  pairTitles,
  type GraphNode,
} from "./graphLogic";
import { createGraphStore, type GraphOptions, type GraphStore } from "./graphStore";

export type GraphAppApi = {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
  setTarget(): Promise<void>;
};

const GROUP_COLORS = [
  "var(--accent, #6a7a88)",
  "#4f8cff",
  "#2bb673",
  "#e0a63f",
  "#c15f9f",
  "#8a63d2",
];

function groupColor(nodes: GraphNode[], node: GraphNode): string {
  const index = nodes.findIndex((candidate) => candidate.group === node.group);
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function conflictReasonLabel(reason: string): string {
  if (reason === "source_changed") return t("Source changed");
  if (reason === "duplicate_title") return t("Duplicate title");
  return reason;
}

function GraphNav() {
  return <nav className="graph-nav" aria-label={t("Knowledge Graph")} />;
}

function GraphMain({ store }: { store: GraphStore }) {
  const data = store((state) => state.data);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const selectedId = store((state) => state.selectedId);

  useEffect(() => {
    void store.getState().load();
  }, [store]);

  const { nodes, edges } = useMemo(() => buildGraph(data ?? { links: [], similar: [], conflicts: [] }), [data]);
  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const hasData = nodes.length > 0 || (data?.conflicts?.length ?? 0) > 0;

  return (
    <div className="graph-main">
      <header className="graph-header">
        <h1>{t("Knowledge Graph")}</h1>
        <p>{t("Visualize note links, backlinks, similar notes and conflicts.")}</p>
      </header>

      {error ? (
        <p className="idphoto-error" role="alert">
          {error}
        </p>
      ) : null}

      {busy && !data ? (
        <p className="idphoto-result-empty">{t("Loading…")}</p>
      ) : hasData ? (
        <div className="graph-workspace">
          <section className="ui-card graph-canvas-card">
            <svg
              className="graph-canvas"
              viewBox="0 0 900 560"
              role="img"
              aria-label={t("Knowledge Graph")}
            >
              {edges.map((edge, index) => {
                const source = positions.get(edge.source);
                const target = positions.get(edge.target);
                if (!source || !target) return null;
                return (
                  <line
                    key={`${edge.source}-${edge.target}-${index}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className={`graph-edge graph-edge--${edge.kind}`}
                  />
                );
              })}
              {nodes.map((node) => {
                const point = positions.get(node.id);
                if (!point) return null;
                const active = selectedId === node.id;
                const label = node.title.length > 18 ? `${node.title.slice(0, 18)}…` : node.title;
                return (
                  <g
                    key={node.id}
                    className={`graph-node${active ? " is-active" : ""}`}
                    onClick={() => store.getState().select(active ? null : node.id)}
                  >
                    <circle cx={point.x} cy={point.y} r={active ? 12 : 8} fill={groupColor(nodes, node)} />
                    {nodes.length <= 18 ? (
                      <text
                        className="graph-node-label"
                        x={point.x}
                        y={point.y + 22}
                        textAnchor="middle"
                      >
                        {label}
                      </text>
                    ) : null}
                    <title>{node.title}</title>
                  </g>
                );
              })}
            </svg>
            <p className="graph-legend">{t("Notes")}: {nodes.length}</p>
          </section>

          <aside className="graph-side">
            <section className="ui-card graph-side-card">
              <h2>{t("Notes")}</h2>
              <ul className="graph-node-list">
                {nodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={`graph-node-button${selectedId === node.id ? " is-active" : ""}`}
                      onClick={() => store.getState().select(selectedId === node.id ? null : node.id)}
                    >
                      <span
                        className="graph-node-dot"
                        style={{ background: groupColor(nodes, node) }}
                      />
                      <span className="graph-node-title">{node.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {(data?.conflicts?.length ?? 0) > 0 ? (
              <section className="ui-card graph-side-card">
                <h2>{t("Conflicts")}</h2>
                <ul className="graph-conflict-list">
                  {data?.conflicts.map((conflict) => (
                    <li
                      key={`${conflict.leftNoteId}-${conflict.rightNoteId}-${conflict.reason}`}
                      className="graph-conflict"
                    >
                      <strong>{pairTitles(conflict.leftTitle, conflict.rightTitle)}</strong>
                      <span>{conflictReasonLabel(conflict.reason)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(data?.similar?.length ?? 0) > 0 ? (
              <section className="ui-card graph-side-card">
                <h2>{t("Similar notes")}</h2>
                <ul className="graph-conflict-list">
                  {data?.similar.map((pair) => (
                    <li
                      key={`${pair.leftNoteId}-${pair.rightNoteId}`}
                      className="graph-conflict"
                    >
                      <strong>{pairTitles(pair.leftTitle, pair.rightTitle)}</strong>
                      <span>{pair.sharedTags.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      ) : (
        <p className="idphoto-result-empty">
          {t("Create links between notes by writing backlinks or sharing tags.")}
        </p>
      )}
    </div>
  );
}

export function createGraphApp(options: GraphOptions): GraphAppApi {
  const store = createGraphStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <GraphNav />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(container, <GraphMain store={store} />, contentRoot);
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "graph.open";
    },
    executeCommand() {},
    refresh() {
      return store.getState().load();
    },
    setTarget() {
      return store.getState().load();
    },
  };
}
