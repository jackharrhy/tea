import type { Handle, RemixNode } from "remix/component";

import type { User } from "#db";

import { Document } from "../actions/document.tsx";
import { Header } from "./header.tsx";
import {
  buttonStyle,
  cardStyle,
  dangerTextStyle,
  primaryButtonStyle,
} from "./styles.ts";
import { css } from "remix/component";

const errorMainStyle = css({
  alignItems: "center",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  minHeight: "100vh",
  padding: "2rem",
});

const errorCardStyle = css({ maxWidth: "36rem", textAlign: "center" });
const errorCodeStyle = css({
  fontSize: "2.25rem",
  fontWeight: 700,
  margin: "0 0 1rem",
});
const errorMessageStyle = css({ fontSize: "1.25rem", margin: "0 0 1rem" });

export interface PageProps {
  children?: RemixNode;
  title?: string;
  user?: Pick<User, "username" | "isAdmin"> | null;
}

export function Page(handle: Handle<PageProps>) {
  return () => {
    const { children, title, user } = handle.props;
    return (
      <Document title={title}>
        <Header user={user} />
        {children}
      </Document>
    );
  };
}

export function ErrorPage(handle: Handle<{ message: string; status: number }>) {
  return () => {
    const { message, status } = handle.props;
    return (
      <Page title={`${status} - artbin`}>
        <main mix={errorMainStyle}>
          <div mix={[cardStyle, errorCardStyle]}>
            <h1 mix={[errorCodeStyle, dangerTextStyle]}>{status}</h1>
            <p mix={errorMessageStyle}>{message}</p>
            <a href="/" mix={[buttonStyle, primaryButtonStyle]}>
              Return home
            </a>
          </div>
        </main>
      </Page>
    );
  };
}
