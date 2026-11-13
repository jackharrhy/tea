import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { uiPrimaryActionStyles } from "@harrhy/ui";
import { Document, type DocumentProps } from "./document.tsx";

type Profile = {
  userName: string;
  human?: {
    profile?: { displayName?: string };
    email?: { email?: string; isEmailVerified?: boolean };
  };
};

type AccountProps = {
  profile: Profile;
  context: Omit<DocumentProps, "title" | "children"> & {
    csrf: string;
    enrollment?: boolean;
  };
};

function AccountPage(handle: Handle<AccountProps>) {
  return () => {
    const { profile, context } = handle.props;
    const name = profile.human?.profile?.displayName || profile.userName;
    const email = profile.human?.email;
    const address =
      email?.email && !email.email.endsWith(".invalid")
        ? email.email
        : "Not set";
    return (
      <Document {...context} title="Account" active="account">
        <section class="account-panel">
          <h1>Account</h1>
          {context.enrollment ? (
            <a class="text-link" href="/enroll">
              Continue joining 4orm
            </a>
          ) : null}
          <dl class="profile">
            <div>
              <dt>Name</dt>
              <dd>{name}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{profile.userName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                {address}
                {email?.isEmailVerified ? (
                  <span class="muted"> (verified)</span>
                ) : null}
              </dd>
            </div>
          </dl>
          <details class="create-user">
            <summary>
              {address === "Not set" ? "Add email" : "Change email"}
            </summary>
            <form action="/account/email" method="post" class="form-stack">
              <input type="hidden" name="csrf" value={context.csrf} />
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={200}
                  required
                />
              </label>
              <label>
                Current password
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  maxLength={200}
                  required
                />
              </label>
              <button class="primary" mix={uiPrimaryActionStyles}>
                Send verification link
              </button>
            </form>
          </details>
          {address !== "Not set" && !email?.isEmailVerified ? (
            <form method="post" action="/account/email/resend">
              <input type="hidden" name="csrf" value={context.csrf} />
              <button>Resend verification link</button>
            </form>
          ) : null}
          <details class="create-user">
            <summary>Change password</summary>
            <form action="/account/password" method="post" class="form-stack">
              <input type="hidden" name="csrf" value={context.csrf} />
              <label>
                Current password
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  maxLength={200}
                  required
                />
              </label>
              <label>
                New password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={200}
                  required
                />
              </label>
              <label>
                Confirm password
                <input
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={200}
                  required
                />
              </label>
              <button class="primary" mix={uiPrimaryActionStyles}>
                Change password
              </button>
            </form>
          </details>
          <p>
            <a class="text-link" href="/account/sessions">
              Review central sessions
            </a>
          </p>
          <p>
            <a class="text-link" href="/">
              Your apps and access details
            </a>
          </p>
        </section>
      </Document>
    );
  };
}

export function renderAccount(
  profile: Profile,
  context: AccountProps["context"],
  nonce: string,
) {
  return renderToString(<AccountPage profile={profile} context={context} />, {
    nonce,
  });
}
