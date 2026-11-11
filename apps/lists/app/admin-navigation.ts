type AdminNavigationLink = {
  href: string;
  label: string;
};

export function adminNavigation(isAdmin: boolean) {
  const primary: AdminNavigationLink[] = [
    { href: "/admin/", label: "Dashboard" },
    { href: "/admin/subscribers", label: "Subscribers" },
    { href: "/admin/lists", label: "Lists" },
    { href: "/admin/campaigns", label: "Campaigns" },
    { href: "/admin/inbound", label: "Inbound" },
  ];
  if (isAdmin) primary.push({ href: "/admin/dmarc", label: "DMARC" });

  const secondary: AdminNavigationLink[] = [
    { href: "/admin/activity", label: "Activity" },
    { href: "/admin/tags", label: "Tags" },
    { href: "/admin/import", label: "Import" },
  ];
  if (isAdmin) secondary.push({ href: "/admin/users", label: "Users" });
  secondary.push(
    { href: "/admin/tokens", label: "API" },
    { href: "/admin/templates", label: "Templates" },
  );

  return { primary, secondary };
}
