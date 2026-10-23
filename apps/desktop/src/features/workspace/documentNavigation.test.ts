import { expect, it } from "vitest";
import { DocumentNavigation } from "./documentNavigation";

it("only accepts the latest navigation result", () => {
  const navigation = new DocumentNavigation();
  const first = navigation.begin();
  expect(first()).toBe(true);
  const second = navigation.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
});

it("invalidates pending reads on close or disposal without affecting another window", () => {
  const first = new DocumentNavigation();
  const second = new DocumentNavigation();
  const pending = first.begin(); const other = second.begin();
  first.invalidate();
  expect(pending()).toBe(false); expect(other()).toBe(true);
  expect(first.begin()()).toBe(true);
});
