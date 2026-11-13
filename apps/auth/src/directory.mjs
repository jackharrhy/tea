export function directoryFor({
  services,
  applications,
  grants,
  subject,
  access,
}) {
  const bindings = access?.initialized() ? access.directoryBindings() : [];
  return services.flatMap((service) => {
    const application = applications.find(
      (app) => app.id === service.applicationId,
    );
    const binding = bindings.find((item) => item.service === service.id);
    const project = application?.projectId || binding?.project_id;
    const grant = grants.find(
      (item) =>
        item.userId === subject &&
        item.projectId === project &&
        item.state === "USER_GRANT_STATE_ACTIVE",
    );
    const blocked = project && access?.blocked(subject, project);
    if (
      blocked ||
      ["held", "retired", "unknown", "prototype"].includes(service.kind) ||
      application?.authorizationHold
    )
      return [];
    const entitled =
      application?.organizationHumansOnly ||
      (grant &&
        (binding?.roles || application?.roles || []).some((role) =>
          grant.roleKeys?.includes(role),
        ));
    if (!entitled && !["public", "join"].includes(service.kind)) return [];
    const setupRequired =
      service.assignmentGuard &&
      access?.initialized() &&
      !access
        .read()
        .links.some(
          (link) => link.subject === subject && link.project === project,
        );
    return [
      {
        ...service,
        project,
        grant,
        setupRequired,
        status: setupRequired
          ? "Setup required"
          : service.kind === "public"
            ? "Public"
            : !entitled && service.kind === "join"
              ? "Join"
              : service.kind === "native"
                ? "Native login"
                : service.kind === "desktop"
                  ? "Desktop app"
                  : "Open",
        sources:
          project && access?.initialized()
            ? access.sources(subject, project)
            : [],
      },
    ];
  });
}

export function directorySections(items) {
  if (items.length < 6) return [{ id: "all", title: null, items }];
  const sections = [
    { id: "apps", title: "Apps" },
    { id: "media", title: "Media" },
    { id: "tools", title: "Your tools" },
  ]
    .map((section) => ({
      ...section,
      items: items.filter(
        (item) => (item.directorySection || "apps") === section.id,
      ),
    }))
    .filter((section) => section.items.length);
  return sections.length > 1 ? sections : [{ id: "all", title: null, items }];
}
