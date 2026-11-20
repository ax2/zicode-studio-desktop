import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { AnimationIntent } from "./AnimationPanel";

interface Clip {
  width: number;
  height: number;
  looped: boolean;
  frames: { durationMs: number; base64: string }[];
}

function readClip(value: unknown): Clip {
  const clip = value as Partial<Clip> | null;
  if (
    !clip ||
    !Number.isInteger(clip.width) ||
    !Number.isInteger(clip.height) ||
    (clip.width ?? 0) < 1 ||
    (clip.height ?? 0) < 1 ||
    (clip.width ?? 0) > 192 ||
    (clip.height ?? 0) > 192 ||
    typeof clip.looped !== "boolean" ||
    !Array.isArray(clip.frames) ||
    clip.frames.length < 1 ||
    clip.frames.length > 128
  ) {
    throw new Error("Invalid animation preview");
  }
  let encoded = 0;
  for (const frame of clip.frames) {
    if (
      !frame ||
      !Number.isInteger(frame.durationMs) ||
      frame.durationMs < 1 ||
      frame.durationMs > 60_000 ||
      typeof frame.base64 !== "string" ||
      !frame.base64.startsWith("iVBORw0KGgo")
    ) {
      throw new Error("Invalid animation preview frame");
    }
    encoded += frame.base64.length;
    if (encoded > 4 * 1024 * 1024 + 512) throw new Error("Animation preview too large");
  }
  return clip as Clip;
}

export function AnimationPlayback({
  intent,
  disabled,
  onPreview,
}: {
  intent: AnimationIntent | null;
  disabled: boolean;
  onPreview: (intent: AnimationIntent) => Promise<unknown>;
}) {
  const [clip, setClip] = useState<Clip>();
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const position = useRef(0);
  const startedAt = useRef(0);
  const timeline = useMemo(() => {
    let end = 0;
    return (
      clip?.frames.map((frame) => {
        end += frame.durationMs;
        return end;
      }) ?? []
    );
  }, [clip]);
  const duration = timeline[timeline.length - 1] ?? 0;

  useEffect(() => {
    return () => {
      requestId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!clip || !playing) return;
    let timer: ReturnType<typeof setTimeout>;
    startedAt.current = performance.now() - position.current;
    function advance() {
      const elapsed = performance.now() - startedAt.current;
      if (!clip) return;
      if (!clip.looped && elapsed >= duration) {
        position.current = duration;
        setFrameIndex(timeline.length - 1);
        setPlaying(false);
        return;
      }
      position.current = elapsed % duration;
      const index = timeline.findIndex((end) => end > position.current);
      setFrameIndex(index);
      timer = setTimeout(advance, Math.max(1, timeline[index] - position.current));
    }
    advance();
    return () => clearTimeout(timer);
  }, [clip, duration, playing, timeline]);

  async function generate() {
    if (!intent || disabled || loading) return;
    const id = ++requestId.current;
    setClip(undefined);
    setPlaying(false);
    setError("");
    setLoading(true);
    try {
      const preview = readClip(await onPreview(intent));
      if (id !== requestId.current) return;
      position.current = 0;
      setFrameIndex(0);
      setClip(preview);
    } catch (reason) {
      if (id !== requestId.current) return;
      setError(
        t(
          String(reason).includes("busy")
            ? "The visual library is busy. Try the animation preview again in a moment."
            : "Could not preview the animation. Check the images and frame settings.",
        ),
      );
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function togglePlayback() {
    if (!clip) return;
    if (playing) {
      const elapsed = performance.now() - startedAt.current;
      position.current = clip.looped ? elapsed % duration : Math.min(elapsed, duration);
    } else if (position.current >= duration) {
      position.current = 0;
    }
    setPlaying(!playing);
  }

  function seek(index: number) {
    position.current = timeline[index - 1] ?? 0;
    setPlaying(false);
    setFrameIndex(index);
  }

  return (
    <div className="visual-assets-animation-preview">
      <div className="ui-toolbar">
        <button
          type="button"
          className="ui-button"
          disabled={disabled || !intent || loading}
          onClick={() => void generate()}
        >
          {t("Generate preview")}
        </button>
        {loading && <span role="status">{t("Preparing animation preview...")}</span>}
      </div>
      {clip && (
        <>
          <div className="visual-assets-animation-stage">
            <img
              src={`data:image/png;base64,${clip.frames[frameIndex].base64}`}
              alt={t("Animation preview frame")}
              width={clip.width}
              height={clip.height}
            />
          </div>
          <div className="ui-toolbar">
            <button type="button" className="ui-button" onClick={togglePlayback}>
              {t(playing ? "Pause animation" : "Play animation")}
            </button>
            <button
              type="button"
              className="ui-button"
              disabled={frameIndex === 0}
              onClick={() => seek(frameIndex - 1)}
            >
              {t("Previous frame")}
            </button>
            <span>
              {frameIndex + 1} / {clip.frames.length}
            </span>
            <button
              type="button"
              className="ui-button"
              disabled={frameIndex === clip.frames.length - 1}
              onClick={() => seek(frameIndex + 1)}
            >
              {t("Next frame")}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
