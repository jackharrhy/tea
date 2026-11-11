import { clientEntry, Frame, ref, type Handle } from "remix/component";

export const NowPlaying = clientEntry(
  import.meta.url,
  function NowPlaying(handle: Handle<{ debug?: boolean }>) {
    let mounted = false;
    return () => (
      <div
        class="now-playing my-7"
        mix={ref(() => {
          mounted = true;
          handle.update();
        })}
      >
        {mounted && (
          <Frame
            src={`/tools/lastfm/now-playing${handle.props.debug ? "?debug" : ""}`}
            fallback={null}
          />
        )}
      </div>
    );
  },
);
