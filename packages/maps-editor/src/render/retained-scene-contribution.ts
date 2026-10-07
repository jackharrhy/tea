import type {
  RetainedSceneContribution,
  SceneContributionName,
  SceneDependencyKey,
} from "./scene-types.js";

export function sceneDependencyKeysEqual(
  left: SceneDependencyKey,
  right: SceneDependencyKey,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]))
  );
}

interface RetainSceneContributionOptions<
  Name extends SceneContributionName,
  Value,
> {
  readonly name: Name;
  readonly key: SceneDependencyKey;
  readonly previous?: RetainedSceneContribution<Name, Value>;
  readonly build: (previousValue: Value | undefined) => Value;
  readonly buffers: (value: Value) => readonly GPUBuffer[];
}

/**
 * Retains an unchanged contribution as a unit. Rebuilt contributions may keep incremental batch
 * buffers; only resources absent from the replacement are retired.
 */
export function retainSceneContribution<
  Name extends SceneContributionName,
  Value,
>(
  options: RetainSceneContributionOptions<Name, Value>,
): {
  readonly contribution: RetainedSceneContribution<Name, Value>;
  readonly rebuilt: boolean;
  retirePrevious(): void;
} {
  const { name, key, previous, build, buffers } = options;
  if (previous && sceneDependencyKeysEqual(previous.key, key)) {
    return { contribution: previous, rebuilt: false, retirePrevious() {} };
  }

  const value = build(previous?.value);
  const retainedBuffers = new Set(buffers(value));
  const retiredBuffers = previous
    ? buffers(previous.value).filter((buffer) => !retainedBuffers.has(buffer))
    : [];
  let replacementCommitted = false;
  let disposed = false;
  return {
    rebuilt: true,
    retirePrevious() {
      if (replacementCommitted) return;
      replacementCommitted = true;
      for (const buffer of new Set(retiredBuffers)) buffer.destroy();
    },
    contribution: {
      name,
      key,
      value,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const buffer of new Set(buffers(value))) buffer.destroy();
      },
    },
  };
}
