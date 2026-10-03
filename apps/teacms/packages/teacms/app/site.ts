import type { Handle, RemixNode } from "remix/component";
import type { ContentStore } from "./data/content.ts";
import type { Page, Sidebar, Media } from "./ui/public/content-types.ts";
import type { Features } from "./ui/public/features.ts";

export type PublicPageProps = {
  page: Page | null;
  store: ContentStore;
  path: string;
  features: Features;
  preview?: boolean;
  previewSite?: boolean;
  visualEditing?: boolean;
  editorSession?: boolean;
};
export type SitePresentation = {
  publicDir: string;
  Page: (handle: Handle<PublicPageProps>) => () => RemixNode;
  NavigationEditor?: (
    handle: Handle<{ sidebar: Sidebar; media: Media[]; pages: Page[] }>,
  ) => () => RemixNode;
};
export type SiteDefinition = SitePresentation & {
  features: Features;
  background: string;
};
export type SiteRuntime = {
  id: string;
  name: string;
  origin: string;
  aliases: string[];
  preview: boolean;
  dataDir: string;
  definition: SiteDefinition;
};
