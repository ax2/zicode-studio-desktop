import { useState } from "react";
import { t } from "../../shared/i18n";
import type { dataTransformPreview } from "./data-transform-result";
import { ToolResultText } from "./ToolResultText";

const pageSize = 25;

export function DataTransformResult({
  result,
  text,
}: {
  result: NonNullable<ReturnType<typeof dataTransformPreview>>;
  text: string;
}) {
  const [page, setPage] = useState(0);
  const { headers, rows, changed, examples } = result;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const start = page * pageSize;
  return (
    <div className="tool-transform-result">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: A focus stop makes the overflowing table keyboard-scrollable. */}
      <section className="tool-transform-table" tabIndex={0} aria-label={t("Table preview")}>
        <table>
          <caption>
            {t("{rows} rows × {columns} columns · {changed} changes")
              .replace("{rows}", String(rows.length))
              .replace("{columns}", String(headers.length))
              .replace("{changed}", String(changed))}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("Data row")}</th>
              {headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(start, start + pageSize).map((row) => (
              <tr key={row.number}>
                <th scope="row">{row.number}</th>
                {row.cells.map((value, column) => (
                  <td key={headers[column]}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {rows.length === 0 && (
        <p role="status">{t("The result has column headers and no data rows.")}</p>
      )}
      {pageCount > 1 && (
        <nav className="ui-toolbar" aria-label={t("Result pages")}>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={page === 0}
            onClick={() => setPage((current) => current - 1)}
          >
            {t("Previous page")}
          </button>
          <span aria-live="polite">
            {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={page + 1 === pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            {t("Next page")}
          </button>
        </nav>
      )}
      {examples.length > 0 && (
        <details>
          <summary>{t("Change examples")}</summary>
          <ul className="tool-transform-examples">
            {examples.map(([before, after]) => (
              <li key={JSON.stringify([before, after])}>
                {before} → {after}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>{t("View and copy result text")}</summary>
        <ToolResultText text={text} />
      </details>
    </div>
  );
}
