import * as s from "remix/data-schema";
import { httpUrl, linkUrl } from "../input.ts";
import { validPlacement } from "../../features/adornments/public/placement.ts";

const text = s.string().refine((v) => v.length <= 2000);
const name = s.string().refine((v) => !!v.trim() && v.length <= 200);
const image = s.union([text, s.literal(null)]);
export const sidebarSchema = s.object({
  top_image_id: image,
  categories: s
    .array(
      s.object({
        categoryTitle: image,
        backgroundImageId: s.optional(image),
        items: s
          .array(s.object({ text, pageSlug: text }))
          .refine((v) => v.length <= 100),
      }),
    )
    .refine((v) => v.length <= 100),
  links: s
    .array(s.object({ service: text, url: text.refine(linkUrl) }))
    .refine((v) => v.length <= 100),
  revision: s.string(),
});
export const siteSchema = s.object({
  analytics_id: s.optional(
    s.string().refine((v) => v === "" || /^G-[A-Z0-9]+$/.test(v)),
  ),
  analytics_enabled: s.optional(s.boolean()),
  site_name: name,
  description: text,
  canonical_origin: text.refine((v) => httpUrl(v) && new URL(v).origin === v),
  background_color: s.string().refine((v) => /^#[\da-f]{6}$/i.test(v)),
  revision: s.string(),
});
export const adornmentSchema = s.object({
  id: s.optional(s.string()),
  name: name.refine((v) => v.length <= 100),
  media_id: s.string(),
  css: s
    .any()
    .refine(validPlacement)
    .transform((v) => v as Record<string, string | number>),
  revision: s.optional(s.string()),
});
