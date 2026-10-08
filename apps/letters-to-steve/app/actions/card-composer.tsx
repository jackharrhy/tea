import type { Handle } from "remix/component";

import { routes } from "../routes.ts";
import type { FormErrors, LetterFormValues } from "./home-page.tsx";
import { RichLetterEditor } from "./write/public/rich-letter-editor.tsx";

interface CardComposerProps {
  draftToken: string;
  errors: FormErrors;
  sent: boolean;
  values: LetterFormValues;
}

export function CardComposer(handle: Handle<CardComposerProps>) {
  return () => {
    let { draftToken, errors, sent, values } = handle.props;

    return (
      <section
        className="composer write-composer"
        id="write"
        aria-labelledby="composer-title"
      >
        <h1 id="composer-title">dear steve,</h1>

        {sent ? (
          <p className="form-success" role="status">
            sent.
          </p>
        ) : null}

        {errors.form ? (
          <p className="field-error" role="alert">
            {errors.form}
          </p>
        ) : null}

        <form action={routes.createLetter.href()} method="post">
          <div className="field letter-field">
            <label htmlFor="letter-body">letter</label>
            <RichLetterEditor
              allowImages
              autoFocus
              body={values.body}
              bodyJson={values.bodyJson}
              describedBy={
                errors.body ? "body-error letter-help" : "letter-help"
              }
              draftToken={draftToken}
              draftTokenFieldName="draftToken"
              fieldName="body"
              fontFieldName="fontKey"
              fontKey={values.fontKey}
              id="letter-body"
              invalid={Boolean(errors.body)}
              jsonFieldName="bodyJson"
              label="Letter"
              required
              showFontPicker
              uploadUrl={routes.uploads.create.href()}
            />
            <span className="field-help" id="letter-help">
              Add up to 10 JPEG, PNG, or WebP images. 10 MB each.
            </span>
            {errors.body ? (
              <span className="field-error" id="body-error">
                {errors.body}
              </span>
            ) : null}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="letter-author">name</label>
              <input
                id="letter-author"
                name="author"
                type="text"
                maxLength={40}
                required
                autoComplete="name"
                aria-invalid={Boolean(errors.author)}
                aria-describedby={errors.author ? "author-error" : undefined}
                defaultValue={values.author}
              />
              {errors.author ? (
                <span className="field-error" id="author-error">
                  {errors.author}
                </span>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="letter-email">email (optional, private)</label>
              <input
                id="letter-email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "email-error" : undefined}
                defaultValue={values.email}
              />
              {errors.email ? (
                <span className="field-error" id="email-error">
                  {errors.email}
                </span>
              ) : null}
            </div>
          </div>

          <label className="permission">
            <input
              type="checkbox"
              name="canPublish"
              value="yes"
              defaultChecked={values.canPublish}
            />
            Steve may publish this letter and my name.
          </label>

          <div className="honeypot" aria-hidden="true">
            <label htmlFor="company">company</label>
            <input
              id="company"
              name="company"
              type="text"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <button type="submit">send</button>
        </form>
      </section>
    );
  };
}
