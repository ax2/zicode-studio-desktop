import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolResultView } from "./ManualToolResultView";
import { dataTransformPreview } from "./data-transform-result";
import { manualToolResult } from "./manual-tool-result";

beforeEach(() => setLocale("en"));
afterEach(cleanup);

const success = (text: string) => ({
  contractVersion: "1.0.0-rc.1",
  ok: true,
  data: { text },
  error: null,
});
const failure = (message: string) => ({
  contractVersion: "1.0.0-rc.1",
  ok: false,
  data: null,
  error: { code: "INVALID_INPUT", message },
});
const report = (headers: string[], rows: unknown[][]) =>
  JSON.stringify({
    changed: 0,
    description: "No change",
    examples: [],
    data: { headers, rows },
    csv: "",
  });
const table = () => within(screen.getByRole("region", { name: "Table preview" }));

it("shows typed values exactly, wraps long header text semantically and retains the complete response", () => {
  const longHeader = "金额项".repeat(64);
  const text = report(
    [longHeader, "details"],
    [["replaceNumber", { price: "nestedNumber", tag: "<img src=x>" }]],
  )
    .replace('"replaceNumber"', "9223372036854775807")
    .replace('"nestedNumber"', "18446744073709551615");
  const response = manualToolResult(success(text));
  render(<ManualToolResultView result={response} dataTransform />);
  expect(table().getByRole("columnheader", { name: longHeader })).toBeTruthy();
  expect(table().getByText("9223372036854775807")).toBeTruthy();
  expect(table().getByText('{"price": 18446744073709551615, "tag": "<img src=x>"}')).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe(text);
  expect((screen.getByLabelText("Original response") as HTMLTextAreaElement).value).toBe(
    response.raw,
  );
});

it("pages through every row, preserves header-only results, and leaves non-table text in the standard view", () => {
  const text = report(
    ["name"],
    Array.from({ length: 26 }, (_, index) => [`label ${index + 1}`]),
  );
  const { rerender } = render(
    <ManualToolResultView result={manualToolResult(success(text))} dataTransform />,
  );
  expect(table().getAllByRole("row")).toHaveLength(26);
  expect(table().queryByText('"label 26"')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(table().getByText('"label 26"')).toBeTruthy();
  expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(table().getByText('"label 1"')).toBeTruthy();

  rerender(
    <ManualToolResultView result={manualToolResult(success(report(["name"], [])))} dataTransform />,
  );
  expect(table().getByRole("columnheader", { name: "name" })).toBeTruthy();
  expect(table().getAllByRole("row")).toHaveLength(1);
  expect(screen.getByText("The result has column headers and no data rows.")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Result pages" })).toBeNull();

  rerender(<ManualToolResultView result={manualToolResult(success(text))} />);
  expect(screen.queryByRole("table")).toBeNull();
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe(text);
});

it("falls back to text for ambiguous columns and keeps worker errors and raw response visible", () => {
  const original = report(["amount", "amount"], [[1, 2]]);
  const { rerender } = render(
    <ManualToolResultView result={manualToolResult(success(original))} dataTransform />,
  );
  expect(screen.queryByRole("table")).toBeNull();
  expect((screen.getByLabelText("Tool result") as HTMLTextAreaElement).value).toBe(original);

  const result = manualToolResult(failure("第 2 行，列 <i>amount</i> 转换失败；原数据未修改"));
  const back = vi.fn();
  rerender(<ManualToolResultView result={result} dataTransform onBackToInputs={back} />);
  expect(
    within(screen.getByRole("alert")).getByText("Data row 2 · column <i>amount</i>"),
  ).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect((screen.getByLabelText("Original response") as HTMLTextAreaElement).value).toBe(
    result.raw,
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to inputs" }));
  expect(back).toHaveBeenCalledTimes(1);
});

const hostResults = process.env.ZICODE_TEST_DATA_TRANSFORM_RESPONSES;
it.runIf(Boolean(hostResults))(
  "renders the six responses emitted by the frozen Compute package through Windows Host/Worker",
  () => {
    const evidence = readFileSync(hostResults as string, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("DATA_TRANSFORM_RESPONSE "))
      .map(
        (line) =>
          JSON.parse(line.slice("DATA_TRANSFORM_RESPONSE ".length)) as {
            name: string;
            result: unknown;
          },
      );
    expect(evidence.map((item) => item.name)).toEqual([
      "integer",
      "failed-row",
      "empty-table",
      "long-header",
      "duplicate-header",
      "nested",
    ]);
    for (const { name, result } of evidence) {
      const outcome = manualToolResult(result);
      const view = render(<ManualToolResultView result={outcome} dataTransform />);
      const current = within(view.container);
      if (name === "failed-row") {
        expect(current.getByText("Data row 2 · column amount")).toBeTruthy();
        expect(current.queryByRole("table")).toBeNull();
      } else if (name === "duplicate-header") {
        expect(current.getByRole("alert").textContent).toContain("重复");
        expect(current.queryByRole("table")).toBeNull();
      } else {
        const preview = dataTransformPreview(outcome.text);
        expect(preview).not.toBeNull();
        expect(current.getByRole("table")).toBeTruthy();
        if (name === "integer") {
          expect(preview?.rows.map((row) => row.cells[0])).toEqual([
            "9223372036854775807",
            "-9223372036854775808",
          ]);
        } else if (name === "empty-table") {
          expect(preview?.rows).toEqual([]);
        } else if (name === "long-header") {
          expect(preview?.headers[0]).toBe("标签".repeat(90));
        } else if (name === "nested") {
          expect(preview?.rows[0].cells[1]).toContain('"amount": 18446744073709551615');
          expect(preview?.rows[0].cells[1]).toContain('"tag": "保留"');
        }
      }
      expect((current.getByLabelText("Original response") as HTMLTextAreaElement).value).toBe(
        outcome.raw,
      );
      view.unmount();
    }
  },
);
