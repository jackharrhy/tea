import type { Handle, RemixNode } from "remix/component";

import type { User } from "#db";

import { Document } from "../actions/document.tsx";
import { Header } from "./header.tsx";

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
