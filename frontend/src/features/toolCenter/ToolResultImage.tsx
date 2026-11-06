import { useEffect, useState } from "react";
import { decodeResourceImage } from "../../../../public/native/plugins/plugin-resource-image.js";
import { t } from "../../shared/i18n";
import type { InlineToolImage } from "./inline-tool-image";
import { ToolResultText } from "./ToolResultText";

export function ToolResultImage({ image, text }: { image: InlineToolImage; text: string }) {
  const [preview, setPreview] = useState<{ source: string; download: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true, source = "", download = "";
    setPreview(null); setFailed(false);
    void decodeResourceImage(image.bytes, image.mimeType, () => active).then(result => {
      if (!active) return;
      source = URL.createObjectURL(result.blob);
      download = URL.createObjectURL(new Blob([image.bytes], { type: image.mimeType }));
      setPreview({ source, download });
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (source) URL.revokeObjectURL(source);
      if (download) URL.revokeObjectURL(download);
    };
  }, [image]);
  return <>
    <figure className="tool-result-image ui-panel" aria-label={t("Image result preview")} aria-busy={!preview && !failed}>
      <figcaption>{t("PNG image · {width} × {height}").replace("{width}", String(image.width)).replace("{height}", String(image.height))}</figcaption>
      {preview && !failed ? <>
        <img src={preview.source} width={image.width} height={image.height} alt={t("Tool output preview")} onError={() => setFailed(true)} />
        <a className="ui-button ui-button--secondary" href={preview.download} download="tool-result.png">{t("Download PNG")}</a>
      </> : <p role="status">{t(failed ? "Image preview unavailable. View or copy the original output below." : "Preparing image preview…")}</p>}
    </figure>
    <details open={failed} className="tool-image-encoded-output">
      <summary>{t("View image encoding")}</summary>
      <ToolResultText key={text} text={text} />
    </details>
  </>;
}
