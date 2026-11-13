import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { uiPrimaryActionStyles } from "@harrhy/ui";
import { Document, type DocumentProps } from "./document.tsx";

type Intent = {
  application: { name: string };
  clientOrigin: string;
  roles: string[];
  request: { scope: string[] };
  selfEnrollment?: boolean;
  offline?: boolean;
};

type AuthorizationProps = {
  intent: Intent;
  id: string;
  context: Omit<DocumentProps, "title" | "children"> & { csrf: string };
};

function AuthorizationPage(handle: Handle<AuthorizationProps>) {
  return () => {
    const { intent, id, context } = handle.props;
    const title = intent.selfEnrollment ? "Join Radio?" : "Allow access?";
    const details = [
      ...(intent.request.scope.includes("profile") ? ["Name and profile"] : []),
      ...(intent.request.scope.includes("email") ? ["Email address"] : []),
      ...(intent.selfEnrollment
        ? [
            "Join Radio: list, join and create rooms, upload tracks, and use room controls.",
          ]
        : []),
      ...(intent.offline ? ["Stay connected until access is revoked"] : []),
    ];
    return (
      <Document {...context} title={title} narrow>
        <h1>{title}</h1>
        <dl class="profile">
          <div>
            <dt>Application</dt>
            <dd>{intent.application.name}</dd>
          </div>
          <div>
            <dt>Client</dt>
            <dd>{intent.clientOrigin}</dd>
          </div>
          <div>
            <dt>Permission</dt>
            <dd>
              {intent.roles
                .map((role) => (role === "admin" ? "Administrator" : role))
                .join(", ")}
            </dd>
          </div>
        </dl>
        {details.length ? (
          <div class="permissions">
            <ul>
              {details.map((detail) => (
                <li>{detail}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <form method="post" action="/authorize">
          <input type="hidden" name="csrf" value={context.csrf} />
          <input type="hidden" name="authRequest" value={id} />
          <div class="actions">
            <button name="decision" value="deny">
              Deny
            </button>
            <button
              class="primary"
              mix={uiPrimaryActionStyles}
              name="decision"
              value="approve"
            >
              Allow
            </button>
          </div>
        </form>
      </Document>
    );
  };
}

export function renderAuthorization(
  intent: Intent,
  id: string,
  context: AuthorizationProps["context"],
  nonce: string,
) {
  return renderToString(
    <AuthorizationPage intent={intent} id={id} context={context} />,
    { nonce },
  );
}
