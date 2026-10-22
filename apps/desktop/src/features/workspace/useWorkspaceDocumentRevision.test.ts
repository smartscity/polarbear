import { afterEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => (() => void) | undefined) => { lifecycle.cleanup = effect(); },
}));
vi.mock("./tauriWorkspaceAdapter", () => ({ getMarkdownFileRevision: vi.fn() }));
import { getMarkdownFileRevision } from "./tauriWorkspaceAdapter";
import { useWorkspaceDocumentRevision } from "./useWorkspaceDocumentRevision";

afterEach(() => { lifecycle.cleanup?.(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("document revision subscription lifetime", () => {
  it("does not report a missing document after its subscription is disposed", async () => {
    vi.stubGlobal("window", { document: { visibilityState: "visible" }, setInterval: () => 1, clearInterval: vi.fn() });
    let finish!: (value: Awaited<ReturnType<typeof getMarkdownFileRevision>>) => void;
    vi.mocked(getMarkdownFileRevision).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const onMissing = vi.fn(); const onChanged = vi.fn();
    useWorkspaceDocumentRevision({ document: { fileId: "a", relativePath: "a.md", workspaceRoot: "/project", revision: "1" }, onMissing, onChanged });
    lifecycle.cleanup?.();
    finish({ exists: false, watchToken: null });
    await Promise.resolve();
    expect(onMissing).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
