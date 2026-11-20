import { useLayoutEffect, useRef } from "react";

// Preserve the existing connection/quick-tools controllers and their DOM nodes.
// Only their shared shell position changes, including when changing application.
export function ActivityUtilities() {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = host.current;
    if (!container) return;
    const nodes = [document.getElementById("quick-tools-anchor"), document.getElementById("status-indicator")?.closest(".status")]
      .filter((node): node is HTMLElement => node instanceof HTMLElement);
    const positions = nodes.map(node => ({ node, parent: node.parentNode, next: node.nextSibling }));
    for (const node of nodes) container.append(node);
    return () => { for (const { node, parent, next } of positions) { if (parent) parent.insertBefore(node, next?.parentNode === parent ? next : null); } };
  }, []);
  return <div className="activity-utilities" ref={host} />;
}
