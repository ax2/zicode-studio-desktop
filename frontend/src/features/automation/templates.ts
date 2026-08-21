import type { AutomationSchedule } from "./logic";

/**
 * Built-in automation templates. Picking one prefills the workflow form so a
 * new user can start from a proven prompt instead of a blank slate (WorkBuddy
 * task templates, adapted to ZiCode's workspace model).
 */
export interface AutomationTemplate {
  id: string;
  /** i18n key shown as the template title. */
  titleKey: string;
  /** i18n key shown as the one-line description. */
  descriptionKey: string;
  /** Actual instruction sent to the agent; written for Chinese users. */
  prompt: string;
  schedule: AutomationSchedule;
  intervalMinutes?: number;
  dailyTime?: string;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "daily-tech-brief",
    titleKey: "Daily tech brief",
    descriptionKey: "Collect yesterday's tech news and write a short brief.",
    prompt:
      "【每日技术简报】收集最近 24 小时的主要技术动态（Hacker News、GitHub Trending、机器之心、InfoQ、掘金等），" +
      "筛选 3-5 条对开发者最有价值的话题，生成一份中文简报，每条包含：一句话摘要、为什么值得关注、来源链接。" +
      "不得编造事实；来源不确定的内容明确标注。输出到工作区根目录 daily-brief-YYYYMMDD.md。",
    schedule: "daily",
    dailyTime: "09:00",
  },
  {
    id: "weekly-report",
    titleKey: "Weekly work report",
    descriptionKey: "Summarize the week's work into a structured report.",
    prompt:
      "【周报汇总】回顾本周的工作内容（可从工作区日志、会话记录和项目文件推断），生成一份结构化周报，包含：" +
      "本周完成事项、关键进展与数据、遇到的问题与解决、下周计划。" +
      "只描述有依据的事实，不确定的内容标注待确认。输出到工作区根目录 weekly-report-YYYYMMDD.md。",
    schedule: "daily",
    dailyTime: "18:00",
  },
  {
    id: "daily-study-plan",
    titleKey: "Daily study plan",
    descriptionKey: "Plan today's learning session with a clear focus.",
    prompt:
      "【每日学习计划】基于用户最近的学习目标（可检查工作区中的学习笔记），生成今天的学习计划：" +
      "1 个核心主题、30-60 分钟的安排、推荐的资料或练习、完成后的自检问题。" +
      "计划要具体可执行，输出为工作区根目录 study-plan-YYYYMMDD.md。",
    schedule: "daily",
    dailyTime: "08:00",
  },
  {
    id: "code-review-sweep",
    titleKey: "Code review sweep",
    descriptionKey: "Scan the project for common issues and summarize findings.",
    prompt:
      "【代码巡检】扫描当前项目的代码，重点检查：明显的 bug 风险、安全敏感点（密钥硬编码、注入、越权）、" +
      "死代码与未使用依赖、不合理的性能热点。输出一份巡检报告，按严重程度分级，每条给出文件位置与修复建议。" +
      "只报告有代码依据的问题，不臆测。输出到工作区根目录 code-review-YYYYMMDD.md。",
    schedule: "interval",
    intervalMinutes: 480,
  },
  {
    id: "news-digest",
    titleKey: "News digest",
    descriptionKey: "Aggregate subscribed sources into a morning digest.",
    prompt:
      "【新闻摘要】汇总指定来源（RSS/网页/剪贴板收件箱中的链接）的内容，生成一份晨间摘要：" +
      "按主题分组，每条含摘要、来源、可点击链接；标注哪些是事实、哪些是观点。输出为工作区根目录 news-digest-YYYYMMDD.md。",
    schedule: "daily",
    dailyTime: "08:30",
  },
];

export function templateById(id: string): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((template) => template.id === id);
}
