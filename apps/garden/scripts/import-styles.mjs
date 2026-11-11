// One-time migration utility: preserve the deployed CSS values and cascade in Remix mixins.
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
      let selector = node.selector.replace(/\[data-astro-cid-[^\]]+\]/g, "");
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
      if (node.name === "property" || node.name === "font-face") {
        properties.push(node.toString());
        continue;
      }
      const key = `@${node.name} ${node.params}`;
      result[key] = convert(node.nodes, top);
    }
  }
  return result;
}
function flattenLayers(nodes) {
  return nodes.flatMap((node) =>
    node.type === "atrule" && node.name === "layer" && node.nodes
      ? flattenLayers(node.nodes)
      : [node],
  );
}
// One mixin per rule keeps late typography overrides after responsive rules.
const styles = flattenLayers(source.nodes)
  .filter(
    (node) =>
      node.name !== "keyframes" &&
      !node.selector?.startsWith(".astro-route-announcer"),
  )
  .map((node) => convert([node], true))
  .filter((value) => Object.keys(value).length > 0);
fs.writeFileSync(
  new URL("../app/ui/legacy-styles.ts", import.meta.url),
  `// Migrated from the deployed Astro CSS. Rule order and rounded values preserve visual parity.\nimport { css } from 'remix/component';\nexport const legacyStyles = [\n${styles.map((value) => `css(${JSON.stringify(value, null, 2)} as Parameters<typeof css>[0])`).join(",\n")}\n];\n`,
);
fs.writeFileSync(
  new URL("../public/properties.css", import.meta.url),
  properties.join("\n") +
    "\n@font-face{font-family:Virgil;src:url(https://excalidraw.com/Virgil.woff2)}\n@font-face{font-family:Cascadia;src:url(https://excalidraw.com/Cascadia.woff2)}\n",
);
