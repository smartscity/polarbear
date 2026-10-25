import { expect, it } from "vitest";
import { DocumentReadRequests, type DocumentReadSnapshot } from "./documentReadRequests";

const document: DocumentReadSnapshot = {
  content: "original", revision: "1", workspaceRoot: "/project", relativePath: "a.md",
};

it("keeps save identity across edits but invalidates it synchronously on close and reopen", () => {
  const requests = new DocumentReadRequests();
  requests.reconcile(new Map([["a", document]]));
  const identity = requests.captureIdentity("a");
  requests.reconcile(new Map([["a", { ...document, content: "new edit" }]]));
  expect(identity?.()).toBe(true);
  requests.close("a");
  requests.reconcile(new Map([["a", document]]));
  expect(identity?.()).toBe(false);
  expect(requests.captureIdentity("a")?.()).toBe(true);
});

it("accepts unchanged reads and isolates concurrent documents and windows", () => {
  const requests = new DocumentReadRequests();
  const otherWindow = new DocumentReadRequests();
  requests.reconcile(new Map([["a", document], ["b", document]]));
  otherWindow.reconcile(new Map([["a", document]]));
  const a = requests.begin("a"); const b = requests.begin("b"); const other = otherWindow.begin("a");
  requests.reconcile(new Map([["a", { ...document, content: "edited" }], ["b", { ...document }]]));
  expect(a?.isCurrent()).toBe(false);
  expect(b?.isCurrent()).toBe(true);
  expect(other?.isCurrent()).toBe(true);
});

it("rejects edited then undone content and closed then reopened identities", () => {
  const requests = new DocumentReadRequests();
  requests.reconcile(new Map([["a", document]]));
  const edited = requests.begin("a");
  requests.invalidate("a");
  requests.reconcile(new Map([["a", { ...document, content: "edited" }]]));
  requests.reconcile(new Map([["a", document]]));
  expect(edited?.isCurrent()).toBe(false);
  const closed = requests.begin("a");
  requests.reconcile(new Map());
  expect(requests.begin("a")).toBeNull();
  requests.reconcile(new Map([["a", document]]));
  expect(closed?.isCurrent()).toBe(false);
});

it.each(["revision", "workspaceRoot", "relativePath"] as const)("invalidates a read when %s changes", (field) => {
  const requests = new DocumentReadRequests();
  requests.reconcile(new Map([["a", document]]));
  const pending = requests.begin("a");
  requests.reconcile(new Map([["a", { ...document, [field]: "changed" }]]));
  expect(pending?.isCurrent()).toBe(false);
});

it("only allows the newest read and consumes its permission once", () => {
  const requests = new DocumentReadRequests();
  requests.reconcile(new Map([["a", document]]));
  const old = requests.begin("a"); const current = requests.begin("a");
  expect(old?.take()).toBe(false);
  expect(current?.take()).toBe(true);
  expect(current?.take()).toBe(false);
  expect(current?.isCurrent()).toBe(false);
});

it("does not let a stale observer invalidate a current request", () => {
  const requests = new DocumentReadRequests();
  requests.reconcile(new Map([["a", document]]));
  const pending = requests.begin("a", document);
  expect(requests.begin("a", { ...document, revision: "old" })).toBeNull();
  expect(requests.begin("a", { ...document, workspaceRoot: "/other" })).toBeNull();
  expect(pending?.take()).toBe(true);
});

it("rejects dismissed or disposed requests without retaining closed documents", () => {
  const requests = new DocumentReadRequests();
  requests.reconcile(new Map([["a", document]]));
  const dismissed = requests.begin("a"); requests.invalidate("a");
  expect(dismissed?.take()).toBe(false);
  const disposed = requests.begin("a"); requests.clear();
  expect(disposed?.take()).toBe(false);
  expect(requests.begin("a")).toBeNull();
});
