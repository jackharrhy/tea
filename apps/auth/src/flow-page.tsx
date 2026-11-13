import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { uiPrimaryActionStyles } from "@harrhy/ui";
import { Document, type DocumentProps } from "./document.tsx";

type FlowContext = Omit<DocumentProps, "title" | "children"> & { csrf: string };

type EnrollmentProfile = {
  userName: string;
  human?: { email?: { email: string; isEmailVerified?: boolean } };
};

function EnrollmentPage(
  handle: Handle<{ context: FlowContext; profile?: EnrollmentProfile }>,
) {
  return () => {
    const { context, profile } = handle.props;
    const verified =
      profile?.human?.email?.isEmailVerified &&
      !profile.human.email.email.endsWith(".invalid");
    return (
      <Document {...context} title="Join 4orm" narrow>
        <h1>Join 4orm</h1>
        {!profile ? (
          <>
            <form method="post" action="/enroll" class="form-stack">
              <input type="hidden" name="csrf" value={context.csrf} />
              <label>
                Username
                <input
                  name="username"
                  autoComplete="username"
                  pattern="[a-z0-9_-]{3,32}"
                  minLength={3}
                  maxLength={32}
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  autoFocus
                />
                <span class="muted">
                  3–32 lowercase letters, numbers, underscores or hyphens.
                </span>
              </label>
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
                Password
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
                Create account
              </button>
            </form>
            <a class="text-link" href="/login?returnTo=/enroll">
              Sign in instead
            </a>
          </>
        ) : verified ? (
          <>
            <p>Join as {profile.userName}.</p>
            <form method="post" action="/enroll/continue">
              <input type="hidden" name="csrf" value={context.csrf} />
              <button class="primary" mix={uiPrimaryActionStyles}>
                Join 4orm
              </button>
            </form>
          </>
        ) : (
          <>
            <p>Verify your email to join.</p>
            <a class="text-link" href="/account">
              Open account
            </a>
          </>
        )}
      </Document>
    );
  };
}

type DeviceRequest = { appName?: string; scope?: string[] };

function DevicePage(
  handle: Handle<{
    request: DeviceRequest;
    userCode: string;
    context: FlowContext;
  }>,
) {
  return () => {
    const { request, userCode, context } = handle.props;
    return (
      <Document {...context} title="Approve sign-in" narrow>
        <h1>Approve sign-in</h1>
        <p class="application-name">{request.appName || "Application"}</p>
        <p class="muted">Approve only if you started this sign-in.</p>
        <form method="post" action="/device" class="actions">
          <input type="hidden" name="csrf" value={context.csrf} />
          <input type="hidden" name="userCode" value={userCode} />
          <button
            class="primary"
            mix={uiPrimaryActionStyles}
            name="decision"
            value="approve"
          >
            Approve
          </button>
          <button name="decision" value="deny">
            Deny
          </button>
        </form>
        <details class="permissions">
          <summary>Permissions</summary>
          <ul>
            {(request.scope || []).map((scope) => (
              <li>{scope}</li>
            ))}
          </ul>
        </details>
      </Document>
    );
  };
}

function DeviceResultPage(
  handle: Handle<{ approved: boolean; context: FlowContext }>,
) {
  return () => (
    <Document {...handle.props.context} title="Device sign-in" narrow>
      <h1>{handle.props.approved ? "Connected" : "Request denied"}</h1>
      <p class="muted">You can return to Lore.</p>
      <a class="text-link" href="/account">
        Account
      </a>
    </Document>
  );
}

function DeviceCodePage(handle: Handle<{ context: FlowContext }>) {
  return () => (
    <Document {...handle.props.context} title="Device code" narrow>
      <h1>Device code</h1>
      <form action="/device" method="get" class="form-stack">
        <label>
          Code
          <input
            name="user_code"
            required
            maxLength={30}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <button class="primary" mix={uiPrimaryActionStyles}>
          Continue
        </button>
      </form>
    </Document>
  );
}

export function renderEnrollment(
  context: FlowContext,
  profile: EnrollmentProfile | undefined,
  nonce: string,
) {
  return renderToString(
    <EnrollmentPage context={context} profile={profile} />,
    { nonce },
  );
}

export function renderDevice(
  request: DeviceRequest,
  userCode: string,
  context: FlowContext,
  nonce: string,
) {
  return renderToString(
    <DevicePage request={request} userCode={userCode} context={context} />,
    { nonce },
  );
}

export function renderDeviceResult(
  approved: boolean,
  context: FlowContext,
  nonce: string,
) {
  return renderToString(
    <DeviceResultPage approved={approved} context={context} />,
    { nonce },
  );
}

export function renderDeviceCode(context: FlowContext, nonce: string) {
  return renderToString(<DeviceCodePage context={context} />, { nonce });
}
