import { css, type Handle, type RemixNode } from "remix/component";

const documentStyle = css({
  colorScheme: "light",
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: "16px",
  color: "#171717",
  background: "#fff",
  "& *": { boxSizing: "border-box" },
  "& a": { color: "inherit", textDecoration: "none" },
  "& :is(a, button):focus-visible": {
    outline: "2px solid #171717",
    outlineOffset: "4px",
  },
});
const bodyStyle = css({ margin: 0, minWidth: "280px" });
export function Document(handle: Handle<{ children?: RemixNode }>) {
  return () => (
    <html lang="en" mix={documentStyle}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>rotund.org</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
      </head>
      <body mix={bodyStyle}>{handle.props.children}</body>
    </html>
  );
}
