// Shared helpers for the Knowledge Graph feature.

export interface GraphLink {
  fromNotebookId: string;
  fromNoteId: string;
  fromTitle: string;
  toNotebookId: string;
  toNoteId: string;
  toTitle: string;
  kind: string;
}

export interface GraphSimilar {
  leftNotebookId: string;
  leftNoteId: string;
  leftTitle: string;
  rightNotebookId: string;
  rightNoteId: string;
  rightTitle: string;
  score: number;
  sharedTags: string[];
}

export interface GraphConflict {
  leftNotebookId: string;
  leftNoteId: string;
  leftTitle: string;
  rightNotebookId: string;
  rightNoteId: string;
  rightTitle: string;
  reason: string;
  sourceUrl?: string;
}

export interface GraphKnowledge {
  links: GraphLink[];
  similar: GraphSimilar[];
  conflicts: GraphConflict[];
}

export interface GraphNode {
  id: string;
  notebookId: string;
  noteId: string;
  title: string;
  group: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface Point {
  x: number;
  y: number;
}

export function noteKey(notebookId: string, noteId: string): string {
  return `${notebookId}\u0000${noteId}`;
}

export function pairTitles(left: string, right: string): string {
  const same = left.trim().toLowerCase() === right.trim().toLowerCase();
  return same ? `${left} ×2` : `${left} ↔ ${right}`;
}

export function buildGraph(data: GraphKnowledge): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>();
  const ensureNode = (notebookId: string, noteId: string, title: string): GraphNode => {
    const key = noteKey(notebookId, noteId);
    const existing = nodeMap.get(key);
    if (existing) return existing;
    const node = { id: key, notebookId, noteId, title, group: notebookId };
    nodeMap.set(key, node);
    return node;
  };

  const edges: GraphEdge[] = [];
  for (const link of data.links ?? []) {
    const source = ensureNode(link.fromNotebookId, link.fromNoteId, link.fromTitle);
    const target = ensureNode(link.toNotebookId, link.toNoteId, link.toTitle);
    edges.push({ source: source.id, target: target.id, kind: link.kind || "link" });
  }
  for (const pair of data.similar ?? []) {
    const source = ensureNode(pair.leftNotebookId, pair.leftNoteId, pair.leftTitle);
    const target = ensureNode(pair.rightNotebookId, pair.rightNoteId, pair.rightTitle);
    edges.push({ source: source.id, target: target.id, kind: "similar" });
  }
  return { nodes: [...nodeMap.values()], edges };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width = 900,
  height = 560,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const random = mulberry32(7);
  const centerX = width / 2;
  const centerY = height / 2;
  for (const node of nodes) {
    positions.set(node.id, {
      x: centerX + (random() - 0.5) * width * 0.4,
      y: centerY + (random() - 0.5) * height * 0.4,
    });
  }
  if (nodes.length <= 1) {
    if (nodes.length === 1) positions.set(nodes[0].id, { x: centerX, y: centerY });
    return positions;
  }

  const area = width * height;
  const k = Math.sqrt(area / nodes.length);
  const iterations = 260;
  for (let step = 0; step < iterations; step += 1) {
    const temperature = 1 - step / iterations;
    for (let a = 0; a < nodes.length; a += 1) {
      const pa = positions.get(nodes[a].id)!;
      for (let b = a + 1; b < nodes.length; b += 1) {
        const pb = positions.get(nodes[b].id)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.5) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          distance = Math.max(0.5, Math.hypot(dx, dy));
        }
        const repulsion = (k * k) / distance * temperature;
        const fx = (dx / distance) * repulsion;
        const fy = (dy / distance) * repulsion;
        pa.x += fx;
        pa.y += fy;
        pb.x -= fx;
        pb.y -= fy;
      }
    }
    for (const edge of edges) {
      const pa = positions.get(edge.source);
      const pb = positions.get(edge.target);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const attraction = (distance * distance) / k * 0.015 * temperature;
      const fx = (dx / distance) * attraction;
      const fy = (dy / distance) * attraction;
      pa.x += fx;
      pa.y += fy;
      pb.x -= fx;
      pb.y -= fy;
    }
    for (const node of nodes) {
      const point = positions.get(node.id)!;
      point.x += (centerX - point.x) * 0.03;
      point.y += (centerY - point.y) * 0.03;
      point.x = clamp(point.x, 36, width - 36);
      point.y = clamp(point.y, 36, height - 36);
    }
  }
  return positions;
}
