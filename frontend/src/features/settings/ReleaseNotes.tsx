import { ReadOnlyMarkdown } from "../../shared/ReadOnlyMarkdown";

export function ReleaseNotes({ body }: { body: string }) {
  return <ReadOnlyMarkdown body={body} allowLinks />;
}
