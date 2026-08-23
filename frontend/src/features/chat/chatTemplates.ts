// Conversation starter templates shown on the welcome screen.
//
// Labels and prompts are English source strings passed through the shared
// i18n pipeline (t()), so zh-CN translations live in public/i18n.js and the
// composer receives the localized text. Prompt strings must stay on a single
// line because t() collapses whitespace before dictionary lookup.

export interface ChatTemplate {
  id: string;
  icon: string;
  label: string;
  prompt: string;
}

export const CHAT_TEMPLATES: readonly ChatTemplate[] = [
  {
    id: "write-blog",
    icon: "✍️",
    label: "Write a tech blog post",
    prompt:
      "Write a technical blog article. Topic: … Requirements: clear structure, concrete examples, concise professional language.",
  },
  {
    id: "translate",
    icon: "🌐",
    label: "Translate text",
    prompt:
      "Translate the text below into the target language, keeping the original meaning and natural phrasing: …",
  },
  {
    id: "organize-notes",
    icon: "📝",
    label: "Organize into notes",
    prompt:
      "Turn the content below into well-structured notes: extract the key points and keep the essential information: …",
  },
  {
    id: "review-code",
    icon: "🔍",
    label: "Review code",
    prompt:
      "Review the code below. Point out issues and suggest concrete improvements: …",
  },
  {
    id: "brainstorm",
    icon: "💡",
    label: "Brainstorm ideas",
    prompt:
      "Brainstorm around the following topic: give as many ideas as possible, then rank the most promising ones: …",
  },
  {
    id: "analyze",
    icon: "📊",
    label: "Analyze data",
    prompt:
      "Analyze the following data or problem and give conclusions and recommendations: …",
  },
];
