import type { CSSProperties } from "react";
import { t } from "../../shared/i18n";
import { gaussianWidth } from "./convNavLogic";

export function ConvNavTrack({
  turnCount,
  activeIdx,
  hoveredIdx,
  onDotClick,
  onDotEnter,
  onDotLeave,
}: {
  turnCount: number;
  activeIdx: number;
  hoveredIdx: number;
  onDotClick(index: number): void;
  onDotEnter(index: number): void;
  onDotLeave(): void;
}) {
  return (
    <>
      {Array.from({ length: turnCount }, (_, index) => {
        const width =
          hoveredIdx >= 0 ? gaussianWidth(Math.abs(index - hoveredIdx)) : null;
        const style: CSSProperties | undefined =
          width === null
            ? undefined
            : ({ "--nav-w": `${width}px` } as CSSProperties);
        return (
          <button
            type="button"
            // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional markers rebuilt per turn list
            key={index}
            className={`conv-nav-dot${index === activeIdx ? " active" : ""}`}
            aria-label={`${t("Jump to conversation")} ${index + 1}`}
            aria-current={index === activeIdx ? "true" : undefined}
            style={style}
            onClick={() => onDotClick(index)}
            onMouseEnter={() => onDotEnter(index)}
            onMouseLeave={onDotLeave}
          />
        );
      })}
    </>
  );
}

export function ConvNavTooltip({ q, a }: { q: string; a: string }) {
  return (
    <>
      <div id="conv-nav-tooltip-q">{q}</div>
      <div
        id="conv-nav-tooltip-sep"
        style={a ? undefined : { display: "none" }}
      />
      <div
        id="conv-nav-tooltip-a"
        style={a ? undefined : { display: "none" }}
      >
        {a}
      </div>
    </>
  );
}
