import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "./openExternalUrl";

const mocks = vi.hoisted(() => ({ native: vi.fn(), invoke: vi.fn(), message: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.native }));
vi.mock("./invokeTauri", () => ({ invokeTauri: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: mocks.message }));
vi.mock("../i18n/translate", () => ({ translateCurrent: (key: string) => key }));

describe("external navigation boundary", () => {
  const open = vi.fn();
  const alert = vi.fn();
  const location = { href: "https://editor.invalid/unsaved" };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.native.mockReturnValue(true);
    mocks.invoke.mockResolvedValue(undefined);
    mocks.message.mockResolvedValue(undefined);
    location.href = "https://editor.invalid/unsaved";
    vi.stubGlobal("window", { open, alert, location });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never falls back to browser navigation after native rejection", async () => {
    mocks.invoke.mockRejectedValue(new Error("private native diagnostic"));
    await openExternalUrl("https://example.com/docs");
    expect(open).not.toHaveBeenCalled();
    expect(location.href).toBe("https://editor.invalid/unsaved");
    expect(mocks.message).toHaveBeenCalledWith("externalUrl.openFailed", expect.any(Object));
  });

  it("uses the browser only outside Tauri and never replaces the editor when open returns null", async () => {
    mocks.native.mockReturnValue(false);
    open.mockReturnValue(null);
    await openExternalUrl("https://example.com/docs?q=a&b=2");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("https://example.com/docs?q=a&b=2", "_blank", "noopener,noreferrer");
    expect(location.href).toBe("https://editor.invalid/unsaved");
  });

  it.each(["javascript:alert(1)", "file:///private/notes.md", "data:text/html,x", "/relative", "https://", "https://user:secret@example.com", "https://example.com/\nnext", "https:\\example.com"])("rejects unsafe URL %s before either launcher", async (url) => {
    await openExternalUrl(url);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(mocks.message).toHaveBeenCalledWith("externalUrl.invalid", expect.any(Object));
  });

  it("opens a valid native URL once without showing an error", async () => {
    await openExternalUrl("https://example.com/docs?q=one&two=2#section");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it("rejects unsafe browser requests without invoking either launcher", async () => {
    mocks.native.mockReturnValue(false);
    await openExternalUrl("javascript:alert(1)");
    expect(alert).toHaveBeenCalledWith("externalUrl.invalid");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("reports browser launcher exceptions without navigating the editor", async () => {
    mocks.native.mockReturnValue(false);
    open.mockImplementation(() => { throw new Error("private browser error"); });
    await openExternalUrl("https://example.com");
    expect(alert).toHaveBeenCalledWith("externalUrl.openFailed");
    expect(location.href).toBe("https://editor.invalid/unsaved");
  });

  it("retains visible feedback when the native error dialog fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("native failure"));
    mocks.message.mockRejectedValue(new Error("dialog failure"));
    await openExternalUrl("https://example.com");
    expect(alert).toHaveBeenCalledWith("externalUrl.openFailed");
    expect(open).not.toHaveBeenCalled();
  });
});
