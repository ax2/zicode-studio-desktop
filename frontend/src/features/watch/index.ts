import { createWatchApp } from "./WatchApp";
import type { WatchOptions } from "./watchStore";
import { WatchHttpGateway } from "./watchStore";

export { createWatchApp } from "./WatchApp";
export { WatchHttpGateway } from "./watchStore";
export type { WatchOptions } from "./watchStore";
export type { WatchCheckResult, WatchItem } from "./watchLogic";

export function setupWatchApp(options: WatchOptions) {
  return createWatchApp({
    gateway: options.gateway ?? new WatchHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
