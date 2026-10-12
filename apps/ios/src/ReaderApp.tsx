import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, FilePlus2, FolderOpen, Languages, List, Search, Settings2, Trash2 } from "lucide-react";
import type { ReaderHeading } from "@polarbear/reader-core";
import { useI18n } from "../../desktop/src/shared/i18n/I18nProvider";
import { titleForCommand } from "../../desktop/src/commands/appCommandRegistry";
import { browserLibrary, importBrowserDocuments } from "./library/browserLibrary";
import { nativeLibrary, importNativeDocuments, nativeOpenDocuments } from "./library/nativeLibrary";
import { subscribeToOpenedDocuments } from "./library/openedDocuments";
import { entryId, readerErrorKey, type LibraryEntry } from "./library/library";
import { readPositions, readSettings, saveSettings, type ReadingSettings } from "./reader/readingState";
import { ReaderSurface } from "./reader/ReaderSurface";
import { Sheet } from "./ui/Sheet";
import logo from "../../desktop/src-tauri/icons/128x128.png";

const library = isTauri() ? nativeLibrary : browserLibrary;

export function ReaderApp() {
  const { t, languages, language, setLanguage } = useI18n();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [active, setActive] = useState<{ entry: LibraryEntry; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(readSettings);
  const [panel, setPanel] = useState<"settings" | "contents" | null>(null);
  const [headings, setHeadings] = useState<ReaderHeading[]>([]);
  const [remove, setRemove] = useState<LibraryEntry | null>(null);
  const [media, setMedia] = useState<{ url: string; title: string } | null>(null);
  const [mediaZoom, setMediaZoom] = useState(100);
  const [readingTools, setReadingTools] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const report = useCallback((key: string) => setError(key), []);
  const expand = useCallback((url: string, title: string) => { setMedia({ url, title }); setMediaZoom(100); }, []);

  const refresh = useCallback(async () => {
    const result = await library.list();
    const positions = readPositions();
    setEntries(result.sort((a, b) => (positions[entryId(b)]?.openedAt ?? b.importedAt) - (positions[entryId(a)]?.openedAt ?? a.importedAt)));
  }, []);
  useEffect(() => { refresh().catch((e: unknown) => report(readerErrorKey(e))); }, [refresh, report]);
  useEffect(() => {
    if (!isTauri()) return;
    const subscription = subscribeToOpenedDocuments(nativeOpenDocuments, async (item, mounted) => {
      if (item.error) { report(readerErrorKey(item.error)); return; }
      const entry = item.entries[0];
      if (!entry) return;
      const generation = ++request.current;
      setBusy(true);
      try {
        const content = await library.read(entry);
        const all = await library.list();
        if (!mounted() || generation !== request.current) return;
        setEntries(all); setActive({ entry, content }); setPanel(null); setReadingTools(false);
        setMedia(null); setRemove(null); setError("");
      } finally { if (mounted() && generation === request.current) setBusy(false); }
    }, (error) => report(readerErrorKey(error)));
    const resume = () => { if (document.visibilityState === "visible") subscription.refresh(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", subscription.refresh);
    return () => {
      subscription.stop();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", subscription.refresh);
    };
  }, [report]);
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.readerTheme = settings.theme === "system" ? (system.matches ? "dark" : "light") : settings.theme; };
    apply(); system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [settings.theme]);

  const open = async (entry: LibraryEntry, anchor?: string) => {
    const generation = ++request.current;
    setBusy(true); setError("");
    try {
      const content = await library.read(entry);
      if (generation !== request.current) return;
      setActive({ entry, content }); setPanel(null); setReadingTools(false);
      if (anchor) requestAnimationFrame(() => requestAnimationFrame(() => {
        let id: string; try { id = decodeURIComponent(anchor); } catch { return; }
        document.getElementById(id)?.scrollIntoView({ block: "start" });
      }));
    } catch (e) { if (generation === request.current) report(readerErrorKey(e)); }
    finally { if (generation === request.current) setBusy(false); }
  };
  const importFiles = async (folder: boolean, files?: File[]) => {
    if (!isTauri() && !files) { (folder ? folderInput : input).current?.click(); return; }
    setBusy(true); setError("");
    try { await (files ? importBrowserDocuments(files) : importNativeDocuments(folder)); await refresh(); }
    catch (e) { report(readerErrorKey(e)); }
    finally { setBusy(false); }
  };
  const updateSettings = (update: Partial<ReadingSettings>) => {
    const next = { ...settings, ...update }; setSettings(next);
    try { saveSettings(next); } catch { report("reader.storageError"); }
  };
  const displayed = entries.filter((e) => e.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  return <main className="reader-app" style={{ "--reader-font-size": `${settings.fontSize}px`, "--reader-line-height": settings.lineHeight } as CSSProperties}>
    <header className="app-header">
      {active ? <button className="icon-button" onClick={() => { ++request.current; setBusy(false); setActive(null); refresh().catch((e: unknown) => report(readerErrorKey(e))); }} aria-label={t("reader.library")}><ArrowLeft /></button> : <img src={logo} className="brand-icon" alt="" />}
      <div className="app-title"><h1>{active ? active.entry.path.split("/").pop() : "Polarbear"}</h1><span>{active ? t("reader.localCopy") : t("reader.library")}</span></div>
      {active && <button className="icon-button" onClick={() => setPanel("contents")} aria-label={t("reader.contents")}><List /></button>}
      {active && <button className="icon-button" onClick={() => setReadingTools(true)} aria-label={t("reader.reading.tools")}><Languages /></button>}
      <button className="icon-button" onClick={() => setPanel("settings")} aria-label={t("reader.settings")}><Settings2 /></button>
    </header>
    {busy && <div className="status-strip" role="status">{t("reader.loading")}</div>}
    {error && <div className="error-strip" role="alert"><span>{t(error)}</span><button onClick={() => setError("")}>{t("common.close")}</button></div>}
    {active ? <div className="reading-scroll" key={entryId(active.entry)}>
      <ReaderSurface readingTools={readingTools} closeReadingTools={() => setReadingTools(false)} content={active.content} entry={active.entry} library={library} onHeadings={setHeadings} report={report} expand={expand} navigate={(path, anchor) => {
        const target = entries.find((e) => e.collection === active.entry.collection && e.path === path);
        if (target) void open(target, anchor); else report("reader.missingDocument");
      }} />
    </div> : <section className="library-view" aria-label={t("reader.library")}>
      <div className="library-tools"><button disabled={busy} onClick={() => void importFiles(false)}><FilePlus2 size={20} />{t("reader.import")}</button><button disabled={busy} onClick={() => void importFiles(true)}><FolderOpen size={20} />{t("reader.importFolder")}</button></div>
      <label className="library-search"><Search size={18} /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("reader.search")} aria-label={titleForCommand("edit.find", t)} /></label>
      {!entries.length && <div className="library-empty"><BookOpen size={52} strokeWidth={1.25} /><h2>{t("reader.emptyLibrary")}</h2><p>{t("reader.emptyLibraryDetail")}</p></div>}
      {!!entries.length && !displayed.length && <p>{t("reader.noResults")}</p>}
      <ul className="book-list">{displayed.map((entry) => <li key={entryId(entry)}><button className="book-open" disabled={busy} onClick={() => void open(entry)}><BookOpen size={24} /><span><strong>{entry.path.split("/").pop()}</strong><small>{entry.path}</small></span></button><button className="icon-button" onClick={() => setRemove(entry)} aria-label={t("reader.remove")}><Trash2 size={18} /></button></li>)}</ul>
      <input ref={input} hidden type="file" accept=".md,.markdown" multiple onChange={(e) => { if (e.target.files?.length) void importFiles(false, Array.from(e.target.files)); e.target.value = ""; }} />
      <input ref={folderInput} hidden type="file" {...{ webkitdirectory: "" }} onChange={(e) => { if (e.target.files?.length) void importFiles(true, Array.from(e.target.files)); e.target.value = ""; }} />
    </section>}
    {panel === "settings" && <Sheet title={t("reader.settings")} close={() => setPanel(null)}>
      <label className="setting-row">{t("reader.fontSize")}<output>{settings.fontSize}</output><input aria-label={t("reader.fontSize")} type="range" min="14" max="28" value={settings.fontSize} onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })} /></label>
      <label className="setting-row">{t("reader.lineHeight")}<output>{settings.lineHeight.toFixed(1)}</output><input aria-label={t("reader.lineHeight")} type="range" min="1.4" max="2.2" step="0.1" value={settings.lineHeight} onChange={(e) => updateSettings({ lineHeight: Number(e.target.value) })} /></label>
      <label className="setting-row">{t("reader.theme")}<select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as ReadingSettings["theme"] })}>{["system", "light", "dark"].map((theme) => <option key={theme} value={theme}>{t(`reader.theme.${theme}`)}</option>)}</select></label>
      <label className="setting-row">{t("reader.language")}<select value={language} onChange={(e) => setLanguage(e.target.value)}>{languages.map((locale) => <option key={locale.code} value={locale.code}>{locale.label}</option>)}</select></label>
    </Sheet>}
    {panel === "contents" && <Sheet title={t("reader.contents")} close={() => setPanel(null)}><nav className="contents-list">{!headings.length && <p>{t("reader.noHeadings")}</p>}{headings.map((h) => <button key={h.id} style={{ paddingInlineStart: `${12 + (h.level - 1) * 12}px` }} onClick={() => { setPanel(null); document.getElementById(h.id)?.scrollIntoView({ block: "start" }); }}>{h.title}</button>)}</nav></Sheet>}
    {remove && <Sheet title={t("reader.remove")} close={() => setRemove(null)}><p>{t("reader.removeConfirm")}</p><button className="danger" disabled={busy} onClick={() => {
      setBusy(true);
      library.remove(remove.collection).then(async () => { setRemove(null); await refresh(); }).catch((e: unknown) => report(readerErrorKey(e))).finally(() => setBusy(false));
    }}>{t("reader.remove")}</button></Sheet>}
    {media && <Sheet full title={media.title || t("reader.diagram")} close={() => setMedia(null)}><label className="media-zoom">{t("reader.zoom")}<input aria-label={t("reader.zoom")} type="range" min="50" max="300" value={mediaZoom} onChange={(e) => setMediaZoom(Number(e.target.value))} /><output>{mediaZoom}%</output></label><div className="media-scroll"><img src={media.url} alt={media.title} style={{ width: `${mediaZoom}%`, maxWidth: "none" }} /></div></Sheet>}
  </main>;
}
