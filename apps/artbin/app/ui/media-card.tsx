import { css, type Handle, type RemixNode } from "remix/component";

import { theme } from "./styles.ts";

const cardStyle = css({
  background: theme.color.background,
  border: `1px solid ${theme.color.borderLight}`,
  color: "inherit",
  display: "block",
  overflow: "hidden",
  textDecoration: "none",
  transition: "border-color 150ms",
  "&:hover": { borderColor: theme.color.border, textDecoration: "none" },
});
const previewStyle = css({
  alignItems: "center",
  aspectRatio: "1",
  background: theme.color.hover,
  display: "flex",
  justifyContent: "center",
  overflow: "hidden",
});
const imageStyle = css({ display: "block", height: "100%", width: "100%" });
const coverStyle = css({ objectFit: "cover" });
const containStyle = css({ objectFit: "contain" });
const placeholderStyle = css({
  color: theme.color.borderLight,
  fontSize: "3rem",
});
const captionStyle = css({
  borderTop: `1px solid ${theme.color.borderLight}`,
  padding: "0.5rem 0.75rem",
});
const titleStyle = css({
  fontWeight: 500,
  margin: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
const metaStyle = css({
  color: theme.color.muted,
  fontSize: "0.75rem",
  margin: "0.25rem 0 0",
});

export interface MediaCardProps {
  href?: string;
  imageSrc?: string;
  imageAlt?: string;
  imageFit?: "cover" | "contain";
  imageRendering?: "auto" | "pixelated";
  placeholder?: string;
  preview?: RemixNode;
  title: string;
  meta?: string;
  footer?: RemixNode;
}

function mediaCardContents(props: MediaCardProps) {
  return (
    <>
      <div mix={previewStyle}>
        {props.preview ??
          (props.imageSrc ? (
            <img
              src={props.imageSrc}
              alt={props.imageAlt ?? ""}
              loading="lazy"
              mix={[
                imageStyle,
                props.imageFit === "contain" ? containStyle : coverStyle,
              ]}
              style={{ imageRendering: props.imageRendering }}
            />
          ) : (
            <span aria-hidden="true" mix={placeholderStyle}>
              {props.placeholder ?? "📁"}
            </span>
          ))}
      </div>
      <div mix={captionStyle}>
        <p mix={titleStyle} title={props.title}>
          {props.title}
        </p>
        {props.meta ? <p mix={metaStyle}>{props.meta}</p> : null}
        {props.footer}
      </div>
    </>
  );
}

export function MediaCard(handle: Handle<MediaCardProps>) {
  return () =>
    handle.props.href ? (
      <a href={handle.props.href} mix={cardStyle}>
        {mediaCardContents(handle.props)}
      </a>
    ) : (
      <div mix={cardStyle}>{mediaCardContents(handle.props)}</div>
    );
}
