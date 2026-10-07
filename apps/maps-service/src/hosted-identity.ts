import slugify from "@sindresorhus/slugify";
import { customAlphabet } from "nanoid";

export const HOSTED_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const HOSTED_ID_LENGTH = 12;

const generateHostedId = customAlphabet(HOSTED_ID_ALPHABET, HOSTED_ID_LENGTH);
const hostedIdPattern = new RegExp(
  `^[${HOSTED_ID_ALPHABET}]{${HOSTED_ID_LENGTH}}$`,
);

export function createHostedId(): string {
  return generateHostedId();
}

export function isHostedId(value: string): boolean {
  return hostedIdPattern.test(value);
}

export function hostedSlug(name: string, kind: "project" | "map"): string {
  const source = kind === "map" ? name.replace(/\.map$/i, "") : name;
  const slug = slugify(source).slice(0, 32).replace(/-+$/, "");
  return slug || kind;
}
