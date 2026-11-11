// One-time migration utility: translate the original compiled stylesheet into a Remix css mixin.
import fs from "node:fs";
import postcss from "postcss";

const source = postcss.parse(fs.readFileSync(process.argv[2], "utf8"));
const properties = [];
function convert(nodes, top = false) {
  const result = {};
  for (const node of nodes) {
    if (node.type === "decl") {
      result[node.prop] = node.value + (node.important ? " !important" : "");
    } else if (node.type === "rule") {
      let selector = node.selector;
      if (top)
        selector = selector
          .split(/,(?![^()]*\))/)
          .map((part) => {
            const value = part.trim();
            return value === ":root" || value === ":host" || value === "html"
              ? "&"
              : `& ${value}`;
          })
          .join(", ");
      result[selector] = { ...result[selector], ...convert(node.nodes) };
    } else if (node.type === "atrule" && node.nodes) {
      if (node.name === "property") {
        properties.push(node.toString());
        continue;
      }
      const key = `@${node.name} ${node.params}`;
      result[key] = convert(node.nodes, top);
    }
  }
  return result;
}
const styles = convert(source.nodes, true);
fs.writeFileSync(
  new URL("../app/ui/legacy-styles.ts", import.meta.url),
  `// Migrated from the original site's compiled CSS. Keep visual changes separate from the port.\nimport { css } from 'remix/component';\nexport const legacyStyles = css(${JSON.stringify(styles, null, 2)} as Parameters<typeof css>[0]);\n`,
);
fs.writeFileSync(
  new URL("../public/properties.css", import.meta.url),
  properties.join("\n") +
    "\n@font-face{font-family:Virgil;src:url(https://excalidraw.com/Virgil.woff2)}\n@font-face{font-family:Cascadia;src:url(https://excalidraw.com/Cascadia.woff2)}\n",
);
