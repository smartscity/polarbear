import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyRichMarkdownDocument } from "./richMarkdownClipboard";

const mocks = vi.hoisted(() => ({ render: vi.fn(), png: vi.fn(), native: vi.fn(), begin: vi.fn(), writeNative: vi.fn() }));
vi.mock("./nativeDocumentClipboard", () => ({
  supportsNativeDocumentCopy: mocks.native, beginNativeDocumentCopy: mocks.begin, writeNativeDocumentCopy: mocks.writeNative,
}));
vi.mock("../diagram/mermaidRenderer", () => ({ renderMermaidSvg: mocks.render }));
vi.mock("../diagram/diagramExport", () => ({ svgContentAsPngDataUrl: mocks.png }));
vi.mock("../../shared/i18n/translate", () => ({ translateCurrent: (key: string) => key }));

class Item {
  constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
}
let sequence = 0;
function setup() {
  const markdown = `# Document ${++sequence}\n\n~~~mermaid\nflowchart TD\nA-->B\n~~~`;
  const values = new Map<string, string>();
  const event = { clipboardData: { setData: (key: string, value: string) => values.set(key, value) }, preventDefault: vi.fn() };
  const report = vi.fn();
  return { markdown, values, event: event as unknown as ClipboardEvent, report };
}

describe("whole-document copy", () => {
  beforeEach(() => {
    mocks.render.mockReset().mockResolvedValue("<svg/>");
    mocks.png.mockReset().mockResolvedValue("data:image/png;base64,diagram");
    mocks.native.mockReset().mockReturnValue(false);
    mocks.begin.mockReset().mockResolvedValue(42);
    mocks.writeNative.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("document", new EventTarget());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts a promised HTML write in the initial copy gesture on a cold cache", async () => {
    let finish!: (value: string) => void;
    mocks.render.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    const write = vi.fn(async (items: Item[]) => { await items[0].data["text/html"]; });
    vi.stubGlobal("navigator", { clipboard: { write } });
    const state = setup();
    expect(copyRichMarkdownDocument(state.event, state.markdown, state.report)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(state.values.get("text/plain")).toBe(state.markdown);
    expect(state.report).toHaveBeenLastCalledWith("clipboard.preparing");
    await Promise.resolve();
    finish("<svg/>");
    const html = await write.mock.calls[0][0][0].data["text/html"];
    expect(await html.text()).toContain("data:image/png;base64,diagram");
    await vi.waitFor(() => expect(state.report).toHaveBeenLastCalledWith("clipboard.richCopied"));
    const again = setup();
    copyRichMarkdownDocument(again.event, state.markdown, again.report);
    expect(again.values.get("text/html")).toContain("data:image/png;base64,diagram");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not silently report success when clipboard permission is denied", async () => {
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn().mockRejectedValue(new Error("denied")) } });
    const state = setup();
    copyRichMarkdownDocument(state.event, state.markdown, state.report);
    await vi.waitFor(() => expect(state.report).toHaveBeenLastCalledWith("clipboard.richCopyFailed"));
    expect(state.values.get("text/plain")).toBe(state.markdown);
  });

  it("cancels a pending payload when another copy supersedes it", async () => {
    let finish!: (value: string) => void;
    mocks.render.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    const write = vi.fn(async (items: Item[]) => { await items[0].data["text/html"]; });
    vi.stubGlobal("navigator", { clipboard: { write } });
    const state = setup();
    copyRichMarkdownDocument(state.event, state.markdown, state.report);
    await Promise.resolve();
    document.dispatchEvent(new Event("copy"));
    finish("<svg/>");
    await expect(write.mock.results[0].value).rejects.toMatchObject({ name: "AbortError" });
    expect(state.report).not.toHaveBeenCalledWith("clipboard.richCopied");
  });

  it("preserves source and explains the fallback in older WebViews", () => {
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", {});
    const state = setup();
    copyRichMarkdownDocument(state.event, state.markdown, state.report);
    expect(state.values.get("text/plain")).toBe(state.markdown);
    expect(state.report).toHaveBeenCalledWith("clipboard.richNotReady");
  });

  it("does not intercept documents without Mermaid", () => {
    const state = setup();
    expect(copyRichMarkdownDocument(state.event, "ordinary text", state.report)).toBe(false);
    expect(state.values.size).toBe(0);
  });

  it("writes native document attachments with the clipboard ownership lease", async () => {
    mocks.native.mockReturnValue(true);
    const state = setup();
    copyRichMarkdownDocument(state.event, state.markdown, state.report);
    await vi.waitFor(() => expect(mocks.writeNative).toHaveBeenCalledWith(state.markdown, expect.stringContaining("data:image/png"), 42));
    expect(mocks.begin).toHaveBeenCalledWith(state.markdown);
    expect(state.values.get("text/plain")).toBe(state.markdown);
    expect(state.report).toHaveBeenLastCalledWith("clipboard.richCopied");
  });

  it("reports native write failures rather than claiming converted images were copied", async () => {
    mocks.native.mockReturnValue(true);
    mocks.writeNative.mockRejectedValue(new Error("native write denied"));
    const state = setup();
    copyRichMarkdownDocument(state.event, state.markdown, state.report);
    await vi.waitFor(() => expect(state.report).toHaveBeenLastCalledWith("clipboard.richCopyFailed"));
    expect(state.report).not.toHaveBeenCalledWith("clipboard.richCopied");
  });
});
