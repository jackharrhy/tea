import { renderToString } from "remix/component/server";
import { Document } from "../../src/document.tsx";
export function renderInterior() {
  return renderToString(
    <Document
      title="Your apps"
      user={{ id: "fixture", name: "Synthetic reviewer" }}
      admin
      active="apps"
      csrf="fixture-only"
    >
      <h1>Your apps</h1>
      <p>
        Read-only synthetic header preview. No account data or active session.
      </p>
    </Document>,
    { nonce: "fixture" },
  );
}
