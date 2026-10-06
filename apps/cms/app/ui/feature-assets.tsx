import type { Handle } from "remix/component";
import type { Features } from "./public/features.ts";
export function FeatureAssets(
  handle: Handle<{ features: Features; preview?: boolean }>,
) {
  return () => (
    <>
      {handle.props.features.riso && !handle.props.preview && (
        <script defer src="/features/riso.js"></script>
      )}
    </>
  );
}
