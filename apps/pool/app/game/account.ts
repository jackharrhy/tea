import { installOwnerTools } from "./admin-tools";

export type Account = Readonly<{
  enabled: boolean;
  authenticated: boolean;
  name: string | null;
  owner: boolean;
  csrf: string | null;
}>;

export async function installAccount(
  signal: AbortSignal,
): Promise<(() => void) | undefined> {
  try {
    const response = await fetch("/api/account", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (!response.ok || signal.aborted) return;
    const account: Account = await response.json();
    if (signal.aborted) return;
    const signIn = document.querySelector<HTMLAnchorElement>("#sign-in");
    if (signIn) signIn.hidden = !account.enabled || account.authenticated;
    if (!account.authenticated) return;
    const container = document.createElement("div");
    container.setAttribute("aria-label", "Account");
    const name = document.createElement("span");
    name.textContent = account.name ?? "Signed-in player";
    const logout = document.createElement("button");
    logout.type = "button";
    logout.textContent = "Sign out";
    logout.addEventListener(
      "click",
      async () => {
        logout.disabled = true;
        try {
          const result = await fetch("/auth/logout", {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-CSRF-Token": account.csrf ?? "" },
          });
          if (!result.ok) throw new Error("Sign out failed");
          location.reload();
        } catch {
          logout.textContent = "Retry sign out";
          logout.disabled = false;
        }
      },
      { signal },
    );
    container.append(name, logout);
    document.querySelector("#menu nav")?.append(container);
    const disposeOwnerTools = account.owner
      ? installOwnerTools(account)
      : undefined;
    return () => {
      disposeOwnerTools?.();
      container.remove();
    };
  } catch {
    // Account availability must not block guest entry.
  }
}
