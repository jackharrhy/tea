import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { uiPrimaryActionStyles } from "@harrhy/ui";
import { Document, type DocumentProps } from "./document.tsx";

type EmailContext = Omit<DocumentProps, "title" | "children"> & {
  csrf?: string;
  passwordPolicy?: {
    minLength: number;
    hasUppercase?: boolean;
    hasLowercase?: boolean;
    hasNumber?: boolean;
    hasSymbol?: boolean;
  };
};

type FormProps = { mode: "verify" | "forgot" | "reset"; context: EmailContext };

function EmailFormPage(handle: Handle<FormProps>) {
  return () => {
    const { mode, context } = handle.props;
    const title = { verify: "Verify email", forgot: "Reset password", reset: "New password" }[mode];
    const action = { verify: "/verify-email", forgot: "/forgot-password", reset: "/reset-password" }[mode];
    const button = { verify: "Verify email", forgot: "Send recovery link", reset: "Save password" }[mode];
    const policy = context.passwordPolicy;
    const composition = policy
      ? [
          policy.hasUppercase && "an uppercase letter",
          policy.hasLowercase && "a lowercase letter",
          policy.hasNumber && "a number",
          policy.hasSymbol && "a symbol",
        ].filter(Boolean)
      : [];
    const requirements = policy
      ? `Use ${policy.minLength}–200 characters${composition.length ? "; include " + composition.join(", ") : ""}.`
      : "";
    return (
      <Document {...context} title={title} narrow>
        <h1>{title}</h1>
        <form method="post" action={action} class="form-stack">
          <input type="hidden" name="csrf" value={context.csrf || ""} />
          {mode === "forgot" ? (
            <label>
              Username or email
              <input name="username" autoComplete="username" required maxLength={250} autoCapitalize="none" spellCheck={false} />
            </label>
          ) : mode === "reset" ? (
            <>
              <p id="password-requirements">{requirements}</p>
              <label>
                New password
                <input name="password" type="password" autoComplete="new-password" aria-describedby="password-requirements" required minLength={policy?.minLength || 12} maxLength={200} />
              </label>
              <label>
                Confirm password
                <input name="confirmation" type="password" autoComplete="new-password" required minLength={policy?.minLength || 12} maxLength={200} />
              </label>
            </>
          ) : <p>Confirm this email address for your account.</p>}
          <button class="primary" mix={uiPrimaryActionStyles}>{button}</button>
        </form>
      </Document>
    );
  };
}

type ResultProps = { title: string; message: string; context: EmailContext };

function EmailResultPage(handle: Handle<ResultProps>) {
  return () => {
    const { title, message, context } = handle.props;
    return (
      <Document {...context} title={title} narrow>
        <h1>{title}</h1>
        <p>{message}</p>
        <a class="text-link" href={context.user ? "/account" : "/login"}>
          {context.user ? "Account" : "Sign in"}
        </a>
      </Document>
    );
  };
}

export function renderEmailForm(mode: FormProps["mode"], context: EmailContext, nonce: string) {
  return renderToString(<EmailFormPage mode={mode} context={context} />, { nonce });
}

export function renderEmailResult(title: string, message: string, context: EmailContext, nonce: string) {
  return renderToString(<EmailResultPage title={title} message={message} context={context} />, { nonce });
}
