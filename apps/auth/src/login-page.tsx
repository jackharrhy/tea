import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { uiPrimaryActionStyles } from "@harrhy/ui";
import { Document } from "./document.tsx";

type LoginProps = { csrf: string; returnTo: string; error?: string };

function LoginPage(handle: Handle<LoginProps>) {
  return () => (
    <Document title="auth" narrow error={handle.props.error}>
      <h1 class="login-title">auth</h1>
      <form method="post" action="/login" class="form-stack">
        <input type="hidden" name="csrf" value={handle.props.csrf} />
        <input type="hidden" name="returnTo" value={handle.props.returnTo} />
        <label>
          Username or email
          <input
            name="username"
            autoComplete="username"
            required
            autoFocus
            maxLength={250}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            maxLength={1000}
          />
        </label>
        <button class="primary" mix={uiPrimaryActionStyles}>
          Sign in
        </button>
      </form>
      <a class="text-link" href="/forgot-password">
        Forgot password?
      </a>
    </Document>
  );
}

export function renderLogin(props: LoginProps, nonce: string) {
  return renderToString(<LoginPage {...props} />, { nonce });
}
