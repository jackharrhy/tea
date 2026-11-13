import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { Document } from "./document.tsx";

function ProblemPage(handle: Handle<{ message: string; back: string; signup: boolean }>) {
  return () => {
    const { message, back, signup } = handle.props;
    return <Document title="Request failed">
      <section class="narrow"><h1>Request failed</h1><p>{message}</p><a href={back}>{signup ? "Back to signup" : "Back to account"}</a></section>
    </Document>;
  };
}

export function renderProblem(message: string, back: string, signup: boolean, nonce: string) {
  return renderToString(<ProblemPage message={message} back={back} signup={signup} />, { nonce });
}
