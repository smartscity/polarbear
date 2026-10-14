import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { undo, redo } from "@codemirror/commands";
import { I18nProvider } from "../../src/shared/i18n/I18nProvider";
import { MarkdownEditor, type MarkdownEditorView } from "../../src/features/editor/components/MarkdownEditor";
import { TyporaLiveEditor } from "../../src/features/editor/components/TyporaLiveEditor";
import { MarkdownPreview } from "../../src/features/editor/components/MarkdownPreview";
import { SettingsDialog } from "../../src/app/layout/SettingsDialog";
import { useVocabReading } from "../../src/features/vocab/useVocabReading";
import { translateReadingLocal } from "../../src/features/vocab/translation/offlineTranslation";
import { applyThemeTokens } from "../../src/features/theme/themeTokens";
import { buildRichMarkdownClipboardHtml } from "../../src/features/editor/richMarkdownClipboard";
import { nativeClipboardRuns } from "../../src/features/editor/nativeDocumentClipboard";
import { markdownClipboardText } from "../../src/features/editor/markdownClipboardText";
import { validateMermaidSource } from "../../src/features/diagram/mermaidRenderer";
import { renderMermaidSvg } from "../../src/features/diagram/mermaidRenderer";
import { svgContentAsPngDataUrl } from "../../src/features/diagram/diagramExport";
import { diagramDocument, flowchartFixtures } from "./mermaidFixtures";
import "../../src/styles.css";

function Harness() {
  const [markdown, setMarkdown] = useState(() => localStorage.getItem("quality.document") ?? "# Reading\n\nAn attractive opportunity.\n\nThis is an English sentence.");
  const [mode, setMode] = useState<"source" | "live" | "preview">("live");
  const [settings, setSettings] = useState(false);
  const [status, setStatus] = useState("");
  const editor = useRef<MarkdownEditorView | null>(null);
  const reading = useVocabReading({ editor, markdown, title: "Quality.md", filePath: null, preview: mode === "preview", onStatus: setStatus });
  useEffect(() => { localStorage.setItem("quality.document", markdown); }, [markdown]);
  useEffect(() => {
    Object.assign(window, { __quality: {
      setMarkdown, setMode, translate: translateReadingLocal, setTheme: applyThemeTokens, source: () => editor.current?.state.doc.toString() ?? markdown,
      select: (from: number, to: number) => editor.current?.dispatch({ selection: { anchor: from, head: to } }),
      undo: () => editor.current && undo(editor.current), redo: () => editor.current && redo(editor.current),
      validate: validateMermaidSource, fixtures: flowchartFixtures, diagramDocument,
      png: async (source: string) => {
        const svg = await renderMermaidSvg("quality-png-debug", source);
        try { return { image: await svgContentAsPngDataUrl(svg), svg }; }
        catch (error) { return { error: String(error), svg }; }
      },
      clipboard: async () => { const html = await buildRichMarkdownClipboardHtml(diagramDocument); return { markdown: diagramDocument, html, plainText: markdownClipboardText(diagramDocument), runs: nativeClipboardRuns(html), expectedChangeCount: 0 }; },
    } });
  }, [markdown]);
  return <main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
    <nav style={{ display: "flex", gap: 12, padding: 12 }}><button onClick={() => setSettings(true)}>Settings</button><button onClick={() => setMode("source")}>Source</button><button onClick={() => setMode("live")}>Live</button><button onClick={() => setMode("preview")}>Preview</button></nav>
    <section className="editor-workspace" style={{ flex: 1, minHeight: 0 }} onPointerDown={reading.onPointerDown} onPointerUp={reading.onPointerUp} onScrollCapture={reading.onScroll}>
      {mode === "source" ? <MarkdownEditor markdownContent={markdown} onMarkdownChange={setMarkdown} onEditorReady={(view) => { editor.current = view; }} onClipboardStatus={setStatus} onImageDrop={() => {}} onImagePaste={() => {}} onCommand={() => {}} />
        : mode === "live" ? <TyporaLiveEditor activeFileId="Quality.md" workspaceRoot="" markdownContent={markdown} onMarkdownChange={setMarkdown} onEditorReady={(view) => { editor.current = view; }} onClipboardStatus={setStatus} onImageDrop={() => {}} onImagePaste={() => {}} />
          : <MarkdownPreview activeFileId="Quality.md" workspaceRoot="" markdownContent={markdown} onClipboardStatus={setStatus} />}
    </section>
    {reading.controls()}{settings && <SettingsDialog onClose={() => setSettings(false)} />}<output role="status">{status}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Harness /></I18nProvider>);
