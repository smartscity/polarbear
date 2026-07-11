import { describe, expect, it } from "vitest";
import { enMessages } from "./en";
import { zhCNMessages } from "./zh-CN";

describe("locale resources", () => {
  it("keep English and Chinese message keys in sync", () => {
    expect(Object.keys(zhCNMessages).sort()).toEqual(Object.keys(enMessages).sort());
  });

  it("uses the short user-facing Quit label", () => {
    expect(enMessages["menu.quit"]).toBe("Quit");
    expect(enMessages["menu.quit"]).not.toContain("Polarbear Desktop");
  });
});
