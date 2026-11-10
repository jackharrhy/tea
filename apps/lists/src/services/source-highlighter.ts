import { codeToHtml } from "shiki";

const THEME = "github-light";

export function highlightTemplateSource(
  source: string | null,
  format: "html" | "mjml" | "text",
) {
  return codeToHtml(source ?? "(text only)", {
    lang: format === "text" ? "text" : "html",
    theme: THEME,
  });
}
