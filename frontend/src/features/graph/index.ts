import { createGraphApp } from "./GraphApp";
import type { GraphOptions } from "./graphStore";

export { createGraphApp } from "./GraphApp";
export type { GraphOptions } from "./graphStore";
export { buildGraph, layoutGraph, noteKey } from "./graphLogic";
export type {
  GraphConflict,
  GraphKnowledge,
  GraphLink,
  GraphNode,
  GraphSimilar,
} from "./graphLogic";

export function setupGraphApp(options: GraphOptions) {
  return createGraphApp(options);
}
