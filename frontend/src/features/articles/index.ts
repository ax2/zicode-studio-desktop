import { createArticlesApp } from "./ArticlesApp";
import type { ArticlesOptions } from "./ArticlesApp";
import { ArticlesHttpGateway } from "./articlesStore";

export { createArticlesApp } from "./ArticlesApp";
export { ArticlesHttpGateway } from "./articlesStore";
export type { ArticlesOptions } from "./ArticlesApp";
export type { Article, ArticleSummary, ArticlesConfig, ArticlesGateway, ArticlesScope } from "./articlesStore";

export function setupArticlesApp(options: ArticlesOptions) {
  return createArticlesApp({
    gateway: options.gateway ?? new ArticlesHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
    openSettings: options.openSettings,
  });
}
