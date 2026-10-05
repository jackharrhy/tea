import andrew from "@tea/cms/sites/andrew";
import luke from "@tea/cms/sites/luke";
import { parseSites } from "../config.ts";

const presentations = { andrew, luke };

type Fixture = {
  id: string;
  template: string;
  name: string;
  origin: string;
  aliases: string[];
  preview: boolean;
};

export function parseFixtureSites(rows: Fixture[], dataRoot: string) {
  return parseSites(
    rows.map(({ id, template, ...config }) => {
      const presentation =
        presentations[template as keyof typeof presentations];
      if (!presentation) throw new Error(`Unknown presentation: ${template}`);
      return {
        id,
        presentation,
        config: {
          ...config,
          features:
            template === "andrew"
              ? { adornments: true, riso: true }
              : { adornments: false, riso: false },
          background: template === "andrew" ? "#f5f0e6" : "#0b080f",
        },
      };
    }),
    dataRoot,
  );
}
