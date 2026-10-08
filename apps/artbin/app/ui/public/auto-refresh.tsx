import {
  clientEntry,
  ref,
  type Handle,
  type SerializableProps,
} from "remix/component";

import { visuallyHiddenStyle } from "../styles.ts";

interface AutoRefreshProps extends SerializableProps {
  active: boolean;
  intervalMs?: number;
}

export const AutoRefresh = clientEntry(
  `${import.meta.url}#AutoRefresh`,
  function AutoRefresh(handle: Handle<AutoRefreshProps>) {
    return () => (
      <span
        aria-hidden="true"
        mix={[
          visuallyHiddenStyle,
          ref((_element, signal) => {
            if (!handle.props.active) return;
            const timer = setInterval(
              () => location.reload(),
              handle.props.intervalMs ?? 2_000,
            );
            signal.addEventListener("abort", () => clearInterval(timer));
          }),
        ]}
      />
    );
  },
);
