import shared from "./shared.js";
import articles from "./articles.js";
import artifacts from "./artifacts.js";
import automation from "./automation.js";
import blog from "./blog.js";
import browser from "./browser.js";
import chat from "./chat.js";
import documents from "./documents.js";
import finance from "./finance.js";
import mail from "./mail.js";
import notes from "./notes.js";
import projects from "./projects.js";
import settings from "./settings.js";
import tasks from "./tasks.js";
import tools from "./tools.js";
import visualAssets from "./visual-assets.js";

export const domains = {
  shared,
  articles,
  artifacts,
  automation,
  blog,
  browser,
  chat,
  documents,
  finance,
  mail,
  notes,
  projects,
  settings,
  tasks,
  tools,
  "visual-assets": visualAssets,
};

export const zhCN = Object.assign(Object.create(null), ...Object.values(domains));
