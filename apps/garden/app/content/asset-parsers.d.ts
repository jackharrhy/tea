declare module "parse-srcset" {
  export default function parseSrcset(value: string): Array<{ url: string }>;
}

declare module "css-tree" {
  interface Node {
    type: string;
    value: string;
    name: string;
    prelude?: Node;
    children?: { first?: Node };
  }
  export function parse(
    source: string,
    options: {
      context: "stylesheet" | "declarationList";
      parseCustomProperty: boolean;
      onParseError: (error: Error) => never;
    },
  ): unknown;
  export function walk(tree: unknown, visit: (node: Node) => void): void;
}
