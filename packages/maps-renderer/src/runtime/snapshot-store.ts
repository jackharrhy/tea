export type SnapshotStoreListener = () => void;

export interface SnapshotReader<T> {
  readonly getSnapshot: () => T;
  readonly subscribe: (listener: SnapshotStoreListener) => () => void;
}

export class SnapshotStore<T> {
  private readonly listeners = new Set<SnapshotStoreListener>();

  public constructor(private snapshot: T) {}

  public readonly getSnapshot = (): T => this.snapshot;

  public readonly subscribe = (
    listener: SnapshotStoreListener,
  ): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public set(next: T): void {
    if (Object.is(next, this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  public update(updater: (current: T) => T): void {
    this.set(updater(this.snapshot));
  }
}

/** Lazily subscribes to a source and only publishes when the selected value changes. */
export function selectSnapshot<T, Selected>(
  source: SnapshotReader<T>,
  selector: (snapshot: T) => Selected,
  equal: (left: Selected, right: Selected) => boolean = Object.is,
): SnapshotReader<Selected> {
  const listeners = new Set<SnapshotStoreListener>();
  let selected = selector(source.getSnapshot());
  let stopSource: (() => void) | null = null;

  const refresh = (): boolean => {
    const next = selector(source.getSnapshot());
    if (equal(selected, next)) return false;
    selected = next;
    return true;
  };

  const publish = (): void => {
    if (!refresh()) return;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => {
      refresh();
      return selected;
    },
    subscribe: (listener) => {
      refresh();
      listeners.add(listener);
      if (listeners.size === 1) stopSource = source.subscribe(publish);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopSource?.();
        stopSource = null;
      };
    },
  };
}
