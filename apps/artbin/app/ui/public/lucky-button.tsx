import {
  clientEntry,
  css,
  on,
  ref,
  type Handle,
  type SerializableProps,
} from "remix/component";

import { routes } from "../../routes.ts";
import { dangerTextStyle, theme } from "../styles.ts";

const rootStyle = css({
  alignItems: "center",
  display: "inline-flex",
  gap: "0.5rem",
});
const contextStyle = css({ color: theme.color.muted });
const contextLinkStyle = css({
  color: theme.color.text,
  "&:hover": { textDecoration: "underline" },
});
const buttonStyle = css({
  background: "transparent",
  border: 0,
  color: theme.color.muted,
  cursor: "pointer",
  fontSize: "0.875rem",
  padding: 0,
  whiteSpace: "nowrap",
  "&:hover": { color: theme.color.text },
});
const errorStyle = css({ fontSize: "0.75rem" });

interface LuckyContext extends SerializableProps {
  sourceHref: string;
  sourceLabel: string;
  folderId?: string;
  wadFileId?: string;
}

interface LuckyButtonProps extends SerializableProps {
  folderId?: string;
  wadFileId?: string;
  sourceLabel?: string;
  excludeHref?: string;
  label?: string;
  historyLabel?: string;
  contextual?: boolean;
  fallbackFolderId?: string;
  fallbackWadFileId?: string;
  fallbackSourceLabel?: string;
}

interface LuckyResponse {
  href?: string;
  error?: string;
}

export const LuckyButton = clientEntry(
  `${import.meta.url}#LuckyButton`,
  function LuckyButton(handle: Handle<LuckyButtonProps>) {
    let loading = false;
    let error: string | null = null;
    let historyContext: LuckyContext | null = null;

    return () => {
      const props = handle.props;
      const fallbackContext = props.fallbackSourceLabel
        ? {
            sourceHref:
              typeof location === "undefined"
                ? ""
                : location.pathname + location.search,
            sourceLabel: props.fallbackSourceLabel,
            folderId: props.fallbackFolderId,
            wadFileId: props.fallbackWadFileId,
          }
        : null;
      const context = props.contextual
        ? (historyContext ?? fallbackContext)
        : {
            sourceHref:
              typeof location === "undefined"
                ? ""
                : location.pathname + location.search,
            sourceLabel: props.sourceLabel ?? "assets",
            folderId: props.folderId,
            wadFileId: props.wadFileId,
          };

      return (
        <span
          mix={[
            rootStyle,
            ref(() => {
              if (!props.contextual || historyContext) return;
              historyContext = getLuckyContext(history.state);
              handle.update();
            }),
          ]}
        >
          {historyContext ? (
            <span mix={contextStyle}>
              Feeling lucky in{" "}
              <a href={historyContext.sourceHref} mix={contextLinkStyle}>
                {historyContext.sourceLabel}
              </a>
            </span>
          ) : null}
          {context ? (
            <button
              type="button"
              mix={[
                buttonStyle,
                on("click", async (_event, signal) => {
                  loading = true;
                  error = null;
                  await handle.update();

                  const form = new FormData();
                  if (context.folderId) form.set("folderId", context.folderId);
                  if (context.wadFileId)
                    form.set("wadFileId", context.wadFileId);
                  if (props.excludeHref)
                    form.set("excludeHref", props.excludeHref);

                  try {
                    const response = await fetch(routes.api.lucky.href(), {
                      method: "POST",
                      body: form,
                      signal,
                    });
                    const result = (await response.json()) as LuckyResponse;
                    if (signal.aborted) return;
                    if (!response.ok || !result.href) {
                      error = result.error ?? "Nothing was found.";
                      loading = false;
                      handle.update();
                      return;
                    }

                    history.pushState({ lucky: context }, "", result.href);
                    location.reload();
                  } catch (caught) {
                    if (signal.aborted) return;
                    error =
                      caught instanceof Error
                        ? caught.message
                        : "Lucky failed.";
                    loading = false;
                    handle.update();
                  }
                }),
              ]}
              disabled={loading}
            >
              {loading
                ? "Finding something..."
                : historyContext
                  ? (props.historyLabel ?? "Lucky again")
                  : (props.label ?? "I'm feeling lucky")}
            </button>
          ) : null}
          {error ? (
            <span role="alert" mix={[errorStyle, dangerTextStyle]}>
              {error}
            </span>
          ) : null}
        </span>
      );
    };
  },
);

export function getLuckyContext(state: unknown): LuckyContext | null {
  if (!state || typeof state !== "object" || !("lucky" in state)) return null;
  const lucky = (state as { lucky?: unknown }).lucky;
  if (!lucky || typeof lucky !== "object") return null;
  const value = lucky as Partial<LuckyContext>;
  if (
    typeof value.sourceHref !== "string" ||
    !value.sourceHref.startsWith("/") ||
    typeof value.sourceLabel !== "string" ||
    (value.folderId !== undefined && typeof value.folderId !== "string") ||
    (value.wadFileId !== undefined && typeof value.wadFileId !== "string")
  ) {
    return null;
  }
  return value as LuckyContext;
}
