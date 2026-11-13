import type { Handle } from "remix/component";
import { getContext } from "remix/middleware/async-context";
import { getCspNonce } from "remix/middleware/csp";
import type { Features } from "./public/features.ts";
export function FeatureAssets(
  handle: Handle<{ features: Features; preview?: boolean }>,
) {
  return () => (
    <>
      {handle.props.features.riso && !handle.props.preview && (
        <script
          defer
          src="/features/riso.js"
          nonce={getCspNonce(getContext())}
        ></script>
      )}
    </>
  );
}
