import { describe, expect, it } from "vitest";
import { ContextSessionLifetime } from "./contextSessionLifetime";

describe("Context session operation ownership", () => {
  it("does not revive old completions after cleanup and reactivation", () => {
    const scope = new ContextSessionLifetime("/project");
    expect(scope.begin()).toBeNull();
    scope.activate(); const old = scope.begin()!;
    scope.dispose(); scope.activate(); const current = scope.begin()!;
    expect(old.isCurrent()).toBe(false);
    old.finish();
    expect(current.isCurrent()).toBe(true);
    expect(current.finish()).toBe(false);
  });
  it("counts concurrent operations and tolerates repeated completion", () => {
    const scope = new ContextSessionLifetime("/project"); scope.activate();
    const first = scope.begin()!; const second = scope.begin()!;
    expect(first.finish()).toBe(true);
    expect(first.finish()).toBe(true);
    expect(second.finish()).toBe(false);
  });
});
