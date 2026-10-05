import type { SerializableProps, SerializableValue } from "remix/component";
import type { Inline } from "@tea/rich-text/inline.ts";
export type { Inline } from "@tea/rich-text/inline.ts";
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface ContentBlock extends SerializableProps {
  id: string;
  type: string;
  props: Record<string, any>;
  content?: Inline[];
  children?: ContentBlock[];
  [key: string]: SerializableValue;
}
export interface Seo extends SerializableProps {
  title: string | null;
  description: string | null;
  image_id: string | null;
  no_index: boolean;
  canonical: string | null;
}
export interface Page extends SerializableProps {
  id: string;
  slug: string;
  title: string;
  blocks: ContentBlock[];
  seo: Seo;
  revision: string;
  hasDraft?: boolean;
  published?: boolean;
}
export interface Media extends SerializableProps {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  path: string;
  alt: string | null;
  created_at: string;
  folder_id?: string | null;
  folder_path?: string;
  description?: string;
}
export interface MediaFolder extends SerializableProps {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
}
export interface Adornment extends SerializableProps {
  revision?: string;
  id: string;
  name: string;
  media_id: string | null;
  css: Record<string, string | number>;
}
export interface Category extends SerializableProps {
  categoryTitle: string | null;
  backgroundImageId?: string | null;
  items: { text: string; pageSlug: string }[];
}
export interface Sidebar extends SerializableProps {
  top_image_id: string | null;
  categories: Category[];
  links: { service: string; url: string }[];
  revision: string;
}
