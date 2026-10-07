import { describe, expect, it, vi } from "vitest";

import {
  SnapshotStore,
  selectSnapshot,
} from "../src/runtime/snapshot-store.js";

describe("snapshot store", () => {
  it("keeps stable snapshots and notifies only for a new identity", () => {
    const initial = { count: 0 };
    const store = new SnapshotStore(initial);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBe(initial);
    store.set(initial);
    expect(listener).not.toHaveBeenCalled();

    store.update((current) => ({ count: current.count + 1 }));
    expect(store.getSnapshot()).toEqual({ count: 1 });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    store.update((current) => ({ count: current.count + 1 }));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("publishes only selected changes and refreshes while unsubscribed", () => {
    const store = new SnapshotStore({ camera: "start", map: "dm1" });
    const camera = selectSnapshot(store, (snapshot) => snapshot.camera);
    const listener = vi.fn();
    const unsubscribe = camera.subscribe(listener);

    store.set({ camera: "start", map: "dm2" });
    expect(listener).not.toHaveBeenCalled();
    store.set({ camera: "moved", map: "dm2" });
    expect(listener).toHaveBeenCalledOnce();
    expect(camera.getSnapshot()).toBe("moved");

    unsubscribe();
    store.set({ camera: "after-unsubscribe", map: "dm2" });
    expect(listener).toHaveBeenCalledOnce();
    expect(camera.getSnapshot()).toBe("after-unsubscribe");
  });
});
