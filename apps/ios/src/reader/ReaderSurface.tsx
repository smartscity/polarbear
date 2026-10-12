import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { renderReaderMarkdown, type ReaderHeading } from "@polarbear/reader-core";
import { resolveDocumentPath, isMarkdownPath } from "@polarbear/reader-core/paths";
import { useI18n } from "../../../desktop/src/shared/i18n/I18nProvider";
import { entryId, type LibraryEntry, type ReaderLibrary } from "../library/library";
import { readPosition, savePosition } from "./readingState";
import { ReaderDiagramView, ReaderImageView } from "./ReaderMedia";
import { useReadingSelection } from "../reading/useReadingSelection";
import { ReadingAssistant } from "../reading/ReadingAssistant";

export function ReaderSurface({ content, entry, library, onHeadings, navigate, expand, report, readingTools, closeReadingTools }: {
  readingTools: boolean; closeReadingTools: () => void;
  content: string; entry: LibraryEntry; library: ReaderLibrary;
  onHeadings: (headings: ReaderHeading[]) => void;
  navigate: (path: string, anchor?: string) => void;
  expand: (url: string, title: string) => void;
  report: (key: string) => void;
}) {
  const { t } = useI18n();
  const document = useMemo(() => renderReaderMarkdown(content), [content]);
  const html = useMemo(() => DOMPurify.sanitize(document.html, {
    FORBID_TAGS: ["style", "script", "iframe", "object", "form"],
    FORBID_ATTR: ["style"],
  }), [document.html]);
  const innerHTML = useMemo(() => ({ __html: html }), [html]);
  const ref = useRef<HTMLElement>(null);
  const reading = useReadingSelection(ref, entry.path.split("/").pop() ?? "");
  const [targets, setTargets] = useState<Map<string, HTMLElement>>(new Map());
  useLayoutEffect(() => {
    const elements = ref.current?.querySelectorAll<HTMLElement>("[data-reader-image], [data-reader-diagram]");
    setTargets(new Map(Array.from(elements ?? []).map((el) => [el.dataset.readerImage ?? el.dataset.readerDiagram!, el])));
    onHeadings(document.headings);
  }, [html, document.headings, onHeadings]);

  useLayoutEffect(() => {
    const article = ref.current;
    const scroller = article?.closest<HTMLElement>(".reading-scroll");
    if (!article || !scroller) return;
    let interacted = false;
    let failed = false;
    const position = readPosition(entryId(entry));
    const restore = () => {
      if (!position || interacted) return;
      const anchor = position.anchor ? Array.from(article.querySelectorAll<HTMLElement>("[id]")).find((el) => el.id === position.anchor) : null;
      scroller.scrollTop = anchor
        ? anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + position.offset
        : position.ratio * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    };
    const save = () => {
      const headings = Array.from(article.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]"));
      const top = scroller.getBoundingClientRect().top;
      const anchor = headings.filter((h) => h.getBoundingClientRect().top <= top + 2).at(-1);
      try {
        savePosition(entryId(entry), {
          anchor: anchor?.id ?? null, offset: anchor ? top - anchor.getBoundingClientRect().top : 0,
          ratio: scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight), openedAt: Date.now(),
        });
      } catch { if (!failed) { failed = true; report("reader.storageError"); } }
    };
    const touch = () => { interacted = true; };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scroll = () => { clearTimeout(timer); timer = setTimeout(save, 200); };
    const observer = new ResizeObserver(restore);
    observer.observe(article);
    restore();
    scroller.addEventListener("pointerdown", touch, { passive: true });
    scroller.addEventListener("touchstart", touch, { passive: true });
    scroller.addEventListener("wheel", touch, { passive: true });
    scroller.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pointerdown", touch, { capture: true, passive: true });
    window.addEventListener("keydown", touch);
    window.addEventListener("pagehide", save);
    const hidden = () => { if (globalThis.document.hidden) save(); };
    globalThis.document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(timer); save(); observer.disconnect();
      scroller.removeEventListener("pointerdown", touch); scroller.removeEventListener("touchstart", touch);
      scroller.removeEventListener("wheel", touch); scroller.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", save); globalThis.document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pointerdown", touch, true); window.removeEventListener("keydown", touch);
    };
  }, [entry, report, html]);

  return <>
    <article ref={ref} className="reader-prose" onClick={(event) => {
      const link = (event.target as Element).closest("a");
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        let id: string; try { id = decodeURIComponent(href.slice(1)); } catch { return; }
        ref.current?.querySelectorAll<HTMLElement>("[id]").forEach((el) => { if (el.id === id) el.scrollIntoView({ block: "start" }); });
        return;
      }
      const path = resolveDocumentPath(entry.path, href);
      if (path && isMarkdownPath(path)) navigate(path, href.split("#")[1]);
      else report("reader.externalLink");
    }} dangerouslySetInnerHTML={innerHTML} />
    {document.images.map((image) => targets.has(image.id) ? createPortal(<ReaderImageView image={image} entry={entry} library={library} expand={expand} />, targets.get(image.id)!, image.id) : null)}
    {document.diagrams.map((diagram) => targets.has(diagram.id) ? createPortal(<ReaderDiagramView diagram={diagram} expand={expand} />, targets.get(diagram.id)!, diagram.id) : null)}
    {!content.trim() && <p className="empty-document">{t("reader.emptyDocument")}</p>}
    <ReadingAssistant selection={reading.selection} dismiss={() => reading.setSelection(null)} manual={readingTools} closeManual={closeReadingTools} />
  </>;
}
