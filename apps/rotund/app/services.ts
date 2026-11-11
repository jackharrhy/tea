export type Service = { id: string; name: string; url: string };
export type Binding = {
  id: string;
  projectId: string;
  requiredAnyRole: string[];
  allowedSubject?: string;
};
const services: Service[] = [
  { id: "jellyfin", name: "Jellyfin", url: "https://jellyfin.rotund.org/" },
  { id: "sonarr", name: "Sonarr", url: "https://sonarr.rotund.org/" },
  { id: "radarr", name: "Radarr", url: "https://radarr.rotund.org/" },
  { id: "prowlarr", name: "Prowlarr", url: "https://prowlarr.rotund.org/" },
  {
    id: "qbittorrent",
    name: "qBittorrent",
    url: "https://qbittorrent.rotund.org/",
  },
  { id: "navidrome", name: "Navidrome", url: "https://music.rotund.org/" },
  { id: "seerr", name: "Seerr", url: "https://seerr.rotund.org/" },
];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const existingIds = ["jellyfin", "sonarr", "radarr", "prowlarr", "qbittorrent"];
export function parseBindings(value: string): Binding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid service entitlement bindings");
  }
  if (!Array.isArray(parsed))
    throw new Error("Invalid service entitlement bindings");
  const bindings = parsed as Binding[];
  const ids = new Set(bindings.map((binding) => binding?.id));
  if (
    ids.size !== bindings.length ||
    !existingIds.every((id) => ids.has(id)) ||
    bindings.some(
      (binding) =>
        !binding ||
        !services.some((service) => service.id === binding.id) ||
        typeof binding.projectId !== "string" ||
        !binding.projectId ||
        !Array.isArray(binding.requiredAnyRole) ||
        !binding.requiredAnyRole.length ||
        binding.requiredAnyRole.some(
          (role) => typeof role !== "string" || !role,
        ) ||
        (binding.allowedSubject !== undefined &&
          (typeof binding.allowedSubject !== "string" ||
            !binding.allowedSubject)) ||
        (binding.id === "seerr" && !binding.allowedSubject),
    )
  )
    throw new Error("Invalid service entitlement bindings");
  return bindings;
}
export function visibleServices(
  claims: Record<string, unknown>,
  bindings: Binding[],
  organizationId: string,
): Service[] {
  return services.filter((service) => {
    const binding = bindings.find((b) => b.id === service.id);
    if (!binding) return false;
    if (binding.allowedSubject && claims.sub !== binding.allowedSubject)
      return false;
    const roles =
      claims[`urn:zitadel:iam:org:project:${binding.projectId}:roles`];
    return (
      record(roles) &&
      binding.requiredAnyRole.some((role) => {
        const organizations = roles[role];
        return (
          record(organizations) &&
          Object.hasOwn(organizations, organizationId) &&
          typeof organizations[organizationId] === "string"
        );
      })
    );
  });
}
