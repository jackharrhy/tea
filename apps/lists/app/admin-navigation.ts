type AdminNavigationLink = {
  href: string;
  label: string;
  fullPage?: boolean;
};

export function adminNavigation(isAdmin: boolean) {
  const primary: AdminNavigationLink[] = [
    { href: "/admin/", label: "Dashboard", fullPage: true },
    { href: "/admin/subscribers", label: "Subscribers" },
    { href: "/admin/lists", label: "Lists", fullPage: true },
    { href: "/admin/campaigns", label: "Campaigns" },
    { href: "/admin/inbound", label: "Inbound" },
  ];
  if (isAdmin) primary.push({ href: "/admin/dmarc", label: "DMARC", fullPage: true });

  const secondary: AdminNavigationLink[] = [
    { href: "/admin/activity", label: "Activity" },
    { href: "/admin/tags", label: "Tags", fullPage: true },
    { href: "/admin/import", label: "Import" },
  ];
  if (isAdmin)
    secondary.push({ href: "/admin/users", label: "Users", fullPage: true });
  secondary.push(
    { href: "/admin/tokens", label: "API", fullPage: true },
    { href: "/admin/templates", label: "Templates" },
    { href: "/design", label: "Design", fullPage: true },
  );

  return { primary, secondary };
}
