import { describe, expect, it, vi } from "vitest";
import { subscribeToOpenedDocuments, type OpenedDocument } from "./openedDocuments";

const entry = { collection: "collection", path: "notes.md", importedAt: 1 };
const item = (id: number): OpenedDocument => ({ id, entries: [entry], error: null });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function bridgeFixture(initial: OpenedDocument[] = []) {
  let pending = initial;
  let notify = () => {};
  const stop = vi.fn();
  const bridge = {
    listen: vi.fn(async (changed: () => void) => { notify = changed; return stop; }),
    pending: vi.fn(async () => [...pending]),
    acknowledge: vi.fn(async (id: number) => { pending = pending.filter((value) => value.id !== id); }),
  };
  return { bridge, stop, notify: () => notify(), add: (value: OpenedDocument) => { pending.push(value); notify(); } };
}

describe("OS document delivery", () => {
  it("consumes a cold-start document after subscribing and acknowledges it", async () => {
    const fixture = bridgeFixture([item(1)]);
    const consume = vi.fn(async () => {});
    const subscription = subscribeToOpenedDocuments(fixture.bridge, consume, vi.fn());
    await tick();
    expect(consume).toHaveBeenCalledTimes(1);
    expect(fixture.bridge.acknowledge).toHaveBeenCalledWith(1);
    fixture.notify(); await tick();
    expect(consume).toHaveBeenCalledTimes(1);
    subscription.stop(); expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it("serializes warm opens and duplicate notifications while consumption is pending", async () => {
    const fixture = bridgeFixture();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ids: number[] = [];
    const subscription = subscribeToOpenedDocuments(fixture.bridge, async (value) => {
      ids.push(value.id); if (value.id === 1) await gate;
    }, vi.fn());
    await tick(); fixture.add(item(1)); await tick();
    fixture.notify(); fixture.add(item(2)); release(); await tick();
    expect(ids).toEqual([1, 2]);
    subscription.stop();
  });

  it("does not acknowledge work after unmount and replays it to a new subscriber", async () => {
    const fixture = bridgeFixture([item(1)]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let activeAfterUnmount = true;
    const first = subscribeToOpenedDocuments(fixture.bridge, async (_value, active) => {
      await gate; activeAfterUnmount = active();
    }, vi.fn());
    await tick(); first.stop(); release(); await tick();
    expect(activeAfterUnmount).toBe(false);
    expect(fixture.bridge.acknowledge).not.toHaveBeenCalled();
    const consume = vi.fn(async () => {});
    const second = subscribeToOpenedDocuments(fixture.bridge, consume, vi.fn());
    await tick(); expect(consume).toHaveBeenCalledOnce(); second.stop();
  });

  it("retries an unacknowledged IPC failure on resume", async () => {
    const fixture = bridgeFixture([item(1)]);
    const consume = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
    const report = vi.fn();
    const subscription = subscribeToOpenedDocuments(fixture.bridge, consume, report);
    await tick(); expect(report).toHaveBeenCalledOnce();
    expect(fixture.bridge.acknowledge).not.toHaveBeenCalled();
    subscription.refresh(); await tick();
    expect(fixture.bridge.acknowledge).toHaveBeenCalledWith(1); subscription.stop();
  });

  it("delivers import errors without losing the next document", async () => {
    const fixture = bridgeFixture([{ id: 1, entries: [], error: "invalidEncoding" }, item(2)]);
    const consume = vi.fn(async () => {});
    const subscription = subscribeToOpenedDocuments(fixture.bridge, consume, vi.fn());
    await tick(); expect(consume).toHaveBeenCalledTimes(2);
    expect(fixture.bridge.acknowledge).toHaveBeenCalledTimes(2); subscription.stop();
  });

  it("releases a listener that finishes registering after cleanup", async () => {
    const fixture = bridgeFixture([item(1)]);
    let release = () => {};
    fixture.bridge.listen.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve(fixture.stop);
    }));
    const subscription = subscribeToOpenedDocuments(fixture.bridge, vi.fn(), vi.fn());
    subscription.stop(); release(); await tick();
    expect(fixture.stop).toHaveBeenCalledOnce();
    expect(fixture.bridge.pending).not.toHaveBeenCalled();
  });
});
