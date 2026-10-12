import { useEffect, useId, useRef, useState } from "react";
import { Expand, FileWarning } from "lucide-react";
import { resolveDocumentPath } from "@polarbear/reader-core/paths";
import type { ReaderDiagram, ReaderImage } from "@polarbear/reader-core";
import { useI18n } from "../../../desktop/src/shared/i18n/I18nProvider";
import { sanitizeDiagramSvg } from "../../../desktop/src/features/diagram/sanitizeDiagramSvg";
import { READER_LIMITS, type LibraryEntry, type ReaderLibrary } from "../library/library";

function useVisible(ref: React.RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

export function ReaderImageView({ image, entry, library, expand }: {
  image: ReaderImage; entry: LibraryEntry; library: ReaderLibrary; expand: (url: string, title: string) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useVisible(ref);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const path = resolveDocumentPath(entry.path, image.source);
  useEffect(() => {
    if (!visible || !path) return;
    let active = true;
    let objectUrl = "";
    library.asset(entry, path).then((asset) => {
      if (!active) return;
      const bytes = Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0));
      const data = asset.mime === "image/svg+xml" ? sanitizeDiagramSvg(new TextDecoder().decode(bytes)) : bytes;
      objectUrl = URL.createObjectURL(new Blob([data], { type: asset.mime }));
      setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, path, entry, library]);
  return <span ref={ref} className="reader-image">
    {!path || failed ? <span className="media-message"><FileWarning size={18} />{t(!path ? "reader.remoteImage" : "reader.missingImage")}<small>{image.source}</small></span>
      : url ? <button className="image-button" onClick={() => expand(url, image.alt)} aria-label={t("reader.expandImage")}><img src={url} alt={image.alt} onError={() => setFailed(true)} /></button>
      : <span className="media-message">{t("reader.loading")}</span>}
  </span>;
}

export function ReaderDiagramView({ diagram, expand }: { diagram: ReaderDiagram; expand: (url: string, title: string) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const visible = useVisible(ref);
  const id = useId().replace(/[^a-z0-9]/gi, "");
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const supported = diagram.language === "mermaid" && diagram.source.length <= READER_LIMITS.diagramCharacters;
  useEffect(() => {
    if (!visible || !supported) return;
    let active = true;
    let objectUrl = "";
    import("../../../desktop/src/features/diagram/mermaidRenderer").then(async ({ renderMermaidSvg }) => {
      if (!active) return;
      const svg = await renderMermaidSvg(`ios-${id}`, diagram.source);
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, supported, diagram.source, id]);
  return <figure ref={ref} className="reader-diagram">
    {url ? <><button className="diagram-expand" onClick={() => expand(url, "Mermaid")} aria-label={t("reader.expandImage")}><Expand size={18} /></button><img src={url} alt={t("reader.diagram")} /></>
      : <p className="media-message">{t(!supported ? (diagram.language === "plantuml" ? "reader.plantUmlOffline" : "reader.diagramTooLarge") : failed ? "reader.diagramError" : "reader.loading")}</p>}
    <details><summary>{t("reader.source")}</summary><pre>{diagram.source}</pre></details>
  </figure>;
}
