import { ReadOnlyMarkdown } from "../../shared/ReadOnlyMarkdown";
import { t } from "../../shared/i18n";

export function BlogDraftPreview({ title, body }: { title: string; body: string }) {
  return (
    <article aria-label={t("Markdown preview")} className="blog-draft-preview">
      {title && <h1 translate="no">{title}</h1>}
      <ReadOnlyMarkdown body={body} />
    </article>
  );
}
