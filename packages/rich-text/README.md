# @tea/rich-text

This package holds the Inline document format and a Remix 3 rich text editor. Format conversion is separate from the UI, so other apps can use the document model without the CMS runtime.

## Entry points

- `@tea/rich-text/inline.ts` defines the Inline content type.
- `@tea/rich-text/text-document.ts` converts between Inline content and TipTap documents.
- `@tea/rich-text/rich-text.tsx` provides the Remix browser editor; `public/rich-text.css` styles it.

Do not import a host app or CMS storage here. Keep conversion separate from browser UI when extending the format.

## Working here

From the root, run `npm ci` and `npm run cms:check` to check this package and its current consumer. Conversion tests live in `__tests__/`; put future tests near their code.
