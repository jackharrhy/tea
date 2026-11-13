import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { Document, type DocumentProps } from "./document.tsx";

type Context = Omit<DocumentProps, "title" | "children"> & { csrf: string };

function SupportPage(handle: Handle<{
  context: Context;
  targetId: string;
  targetName?: string;
  actorName?: string;
  message?: string;
}>) {
  return () => {
    const { context, targetId, targetName, actorName, message } = handle.props;
    return <Document {...context} title={message ? "Support login" : "Artbin"}>
      <section class="narrow">
        <h1>{message ? "Support login" : "Artbin"}</h1>
        {message ? <p>{message}</p> : <>
          <p>View as {targetName}.</p>
          <p class="muted">You: {actorName} · Up to ten minutes. Your identity stays visible.</p>
          <form method="post" class="form-stack">
            <input type="hidden" name="csrf" value={context.csrf} />
            <input type="hidden" name="consumer" value="artbin" />
            <label>Reason<textarea name="reason" required minLength={3} maxLength={500}></textarea></label>
            <button>Continue to Artbin</button>
          </form>
        </>}
        <p><a href={`/manage/people/${encodeURIComponent(targetId)}`}>{message ? "Back" : "Back to person"}</a></p>
      </section>
    </Document>;
  };
}

export function renderSupportPage(context: Context, targetId: string, nonce: string, details: { targetName?: string; actorName?: string; message?: string }) {
  return renderToString(<SupportPage context={context} targetId={targetId} {...details} />, { nonce });
}
