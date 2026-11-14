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
    id: "cleanuparr",
    name: "Cleanuparr",
    url: "https://cleanuparr.rotund.org/",
  },
  {
    id: "qbittorrent",
    name: "qBittorrent",
    url: "https://qbittorrent.rotund.org/",
  },
  { id: "slskd", name: "slskd (Soulseek)", url: "https://slskd.rotund.org/" },
  { id: "navidrome", name: "Navidrome", url: "https://music.rotund.org/" },
  { id: "seerr", name: "Seerr", url: "https://seerr.rotund.org/" },
];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const existingIds = ["jellyfin", "sonarr", "radarr", "prowlarr", "qbittorrent"];
const mediaAdminIds = ["sonarr", "radarr", "prowlarr", "qbittorrent"];

function sameAccess(
  a: Binding,
  b: Binding,
  allowOwnerRestriction = false,
): boolean {
  const rolesA = a.requiredAnyRole.toSorted();
  const rolesB = b.requiredAnyRole.toSorted();
  return (
    a.projectId === b.projectId &&
    (a.allowedSubject === b.allowedSubject ||
      (allowOwnerRestriction && !b.allowedSubject)) &&
    rolesA.length === rolesB.length &&
    rolesA.every((role, index) => role === rolesB[index])
  );
}

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
  const mediaAdmin = bindings.find((binding) => binding?.id === "sonarr");
  const seerr = bindings.find((binding) => binding?.id === "seerr");
  const jellyfin = bindings.find((binding) => binding?.id === "jellyfin");
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
        (binding.id === "slskd" && !binding.allowedSubject),
    ) ||
    (seerr &&
      !seerr.allowedSubject &&
      (!jellyfin || !sameAccess(seerr, jellyfin))) ||
    bindings.some(
      (binding) =>
        ["cleanuparr", "slskd"].includes(binding.id) &&
        (!mediaAdmin ||
          !mediaAdminIds.every((id) => {
            const member = bindings.find((candidate) => candidate?.id === id);
            return member && sameAccess(member, mediaAdmin);
          }) ||
          !sameAccess(binding, mediaAdmin, binding.id === "slskd")),
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
