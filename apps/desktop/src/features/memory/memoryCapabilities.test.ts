import { describe, expect, it } from "vitest";
import { negotiateMemoryCapabilities } from "./memoryCapabilities";

describe("Memory capability negotiation", () => {
  it("keeps browsing available when optional administration capabilities are absent", () => {
    const result = negotiateMemoryCapabilities("1.7", ["projects.status", "memories.list", "memories.get"]);
    expect(result.compatible).toBe(true);
    expect(result.available.has("backups.create")).toBe(false);
  });

  it("rejects an incompatible major or a missing core browsing capability", () => {
    expect(negotiateMemoryCapabilities("2.0", ["projects.status", "memories.list", "memories.get"]).compatible).toBe(false);
    const missing = negotiateMemoryCapabilities("1.0", ["projects.status", "memories.list"]);
    expect(missing.compatible).toBe(false);
    expect(missing.missingCore).toEqual(["memories.get"]);
  });
});
