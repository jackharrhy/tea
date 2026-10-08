import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ResolvedPublicAddress {
  address: string;
  family: 4 | 6;
}

type AddressResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ResolvedPublicAddress[]>;

const defaultAddressResolver: AddressResolver = async (hostname, options) =>
  (await lookup(hostname, options)).map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet)))
    return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;

  return true;
}

function expandIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    if (!isPublicIpv4(ipv4)) return null;
    const octets = ipv4.split(".").map(Number);
    address = `${normalized.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  } else {
    address = normalized;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;

  const groups = [...left, ...Array(missing).fill("0"), ...right].map((group) =>
    Number.parseInt(group || "0", 16),
  );
  if (
    groups.length !== 8 ||
    groups.some((group) => !Number.isInteger(group) || group > 0xffff)
  ) {
    return null;
  }
  return groups;
}

export function isPublicRemoteAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const groups = expandIpv6(address);
  if (!groups) return false;

  // Only globally routable IPv6 unicast (2000::/3). This deliberately excludes
  // loopback, link-local, unique-local, multicast, documentation, and tunnels.
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  if (groups[0] === 0x2002) return false;
  if (
    groups[0] === 0x2001 &&
    (groups[1] === 0 ||
      groups[1] === 0x10 ||
      groups[1] === 0x20 ||
      groups[1] === 0xdb8)
  ) {
    return false;
  }
  return true;
}

export function validatePublicHttpsUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (url.protocol !== "https:")
    throw new Error("Direct archive URLs must use HTTPS");
  if (url.username || url.password)
    throw new Error("Direct archive URLs cannot contain credentials");
  if (url.port && url.port !== "443")
    throw new Error("Direct archive URLs must use HTTPS port 443");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (!hostname.includes(".") && isIP(hostname) === 0)
  ) {
    throw new Error("Direct archive URLs must use a public internet host");
  }
  if (isIP(hostname) && !isPublicRemoteAddress(hostname)) {
    throw new Error(
      "Direct archive URLs cannot use private or reserved addresses",
    );
  }

  return url;
}

export async function resolvePublicHttpsUrl(
  input: string,
  resolver: AddressResolver = defaultAddressResolver,
): Promise<{
  url: URL;
  address: ResolvedPublicAddress;
}> {
  const url = validatePublicHttpsUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolver(hostname, { all: true, verbatim: true });

  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicRemoteAddress(address.address))
  ) {
    throw new Error(
      "Direct archive URL resolved to a private or reserved address",
    );
  }

  return { url, address: addresses[0] as ResolvedPublicAddress };
}
