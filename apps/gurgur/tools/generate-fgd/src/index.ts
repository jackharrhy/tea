import {
  entityDefinitions,
  SKIP_MATERIAL,
  type PropertyDefinition,
} from "@tea/gurgur-game";

const fgdType = (property: PropertyDefinition): string =>
  ({
    string: "string",
    number: "float",
    boolean: "choices",
    vector: "vector",
    angles: "angle",
    choices: "choices",
    target: "target_destination",
    targetname: "target_source",
  })[property.editor.type];

const quote = (value: string | number | boolean): string =>
  ` : "${String(value)}"`;
const lines = ["// Generated from @tea/gurgur-game. Do not edit by hand.", ""];
for (const [classname, definition] of Object.entries(entityDefinitions)) {
  const kind = definition.editor.kind === "solid" ? "SolidClass" : "PointClass";
  const size = definition.editor.size
    ? ` size(${definition.editor.size.slice(0, 3).join(" ")}, ${definition.editor.size.slice(3).join(" ")})`
    : "";
  lines.push(
    `@${kind} color(${definition.editor.color.join(" ")})${size} = ${classname} : "${definition.editor.description}"`,
  );
  lines.push("[");
  lines.push('  classname(string) : "Entity class" : "' + classname + '"');
  const properties = {
    ...(definition.editor.persistent
      ? {
          authoredId: {
            editor: {
              type: "string" as const,
              description: "Stable unique persistence identity",
            },
          },
        }
      : {}),
    ...definition.properties,
  };
  for (const [name, property] of Object.entries(properties)) {
    if (property.editor.type === "boolean") {
      lines.push(
        `  ${name}(choices) : "${property.editor.description}" : ${property.editor.default ? 1 : 0} = [ 0 : "No" 1 : "Yes" ]`,
      );
    } else if (property.editor.type === "choices") {
      const choices = property.editor.choices
        ?.map(
          (choice: { value: string | number; label: string }) =>
            `${typeof choice.value === "string" ? `"${choice.value}"` : choice.value} : "${choice.label}"`,
        )
        .join(" ");
      lines.push(
        `  ${name}(choices) : "${property.editor.description}"${quote(property.editor.default ?? "")} = [ ${choices ?? ""} ]`,
      );
    } else {
      const defaultValue =
        property.editor.default === undefined
          ? ""
          : quote(property.editor.default);
      lines.push(
        `  ${name}(${fgdType(property as PropertyDefinition)}) : "${property.editor.description}"${defaultValue}`,
      );
    }
  }
  lines.push("]", "");
}

await Bun.write("content/trenchbroom/Gurgur.fgd", `${lines.join("\n")}\n`);
const gameConfig = {
  version: 9,
  name: "Gurgur",
  fileformats: [{ format: "Valve" }],
  filesystem: {
    searchpath: ".",
    packageformat: { extension: ".zip", format: "zip" },
  },
  materials: {
    root: "textures",
    format: { extensions: [".png", ".jpg", ".jpeg"], format: "image" },
  },
  entities: {
    definitions: ["Gurgur.fgd"],
    defaultcolor: "0.6 0.7 0.65 1.0",
  },
  tags: {
    brush: [
      {
        name: "Trigger",
        attribs: ["transparent"],
        match: "classname",
        pattern: "trigger_*",
      },
    ],
    brushface: [
      {
        name: "Skip",
        attribs: ["transparent"],
        match: "material",
        pattern: SKIP_MATERIAL,
      },
      {
        name: "Reality",
        attribs: [],
        match: "material",
        pattern: "GURGUR/REAL/*",
      },
      {
        name: "Reality (Dylan)",
        attribs: [],
        match: "material",
        pattern: "GURGUR/dylans*",
      },
    ],
  },
  faceattribs: {
    defaults: { scale: [0.5, 0.5] },
    surfaceflags: [],
    contentflags: [],
  },
  softMapBounds: "-4096 -4096 -4096 4096 4096 4096",
  compilationTools: [
    {
      name: "gurgur-compile-map",
      description: "Gurgur deterministic Valve 220 compiler",
    },
  ],
};
await Bun.write(
  "content/trenchbroom/GameConfig.cfg",
  `${JSON.stringify(gameConfig, null, 2)}\n`,
);

const materialNames = new Set<string>();
const mapFiles = new Bun.Glob("content/maps/**/*.map");
for await (const path of mapFiles.scan({ dot: false })) {
  if (path.includes("/autosave/")) continue;
  const source = await Bun.file(path).text();
  for (const match of source.matchAll(/\)\s+([^\s]+)\s+\[/g))
    materialNames.add(match[1]!);
}
for (const material of [...materialNames].toSorted()) {
  const texturePath = `content/textures/${material}.png`;
  if (!(await Bun.file(texturePath).exists())) {
    throw new Error(`missing authored material texture: ${texturePath}`);
  }
}
console.log(
  `generated TrenchBroom FGD/game config (${Object.keys(entityDefinitions).length} classes, ${materialNames.size} authored textures)`,
);
