import type { Handle } from "remix/component";
import type { Features } from "./public/features.ts";
export function FeatureAssets(
  handle: Handle<{ features: Features; preview?: boolean }>,
) {
  return () => (
    <>
      {handle.props.features.adornments && (
        <link rel="stylesheet" href="/features/adornments.css" />
      )}
      {handle.props.features.riso && (
        <link rel="stylesheet" href="/features/riso.css" />
      )}
      {handle.props.features.riso && !handle.props.preview && (
        <script defer src="/features/riso.js"></script>
      )}
    </>
  );
}
