import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { Document, type DocumentProps } from "./document.tsx";

type Context = Omit<DocumentProps, "title" | "children"> & { csrf: string };
type Person = {
  userName: string;
  state?: string;
  human?: { profile?: { displayName?: string }; email?: { email?: string } };
};
type Operation = {
  id: string;
  reason: string;
  state: string;
  created_at: string;
  body: {
    completed?: unknown[];
    effects: unknown[];
    cleanup?: { note: string; state: string }[];
  };
};

const nameOf = (user: Person) =>
  user.human?.profile?.displayName || user.userName || "Person";
const statusOf = (user: Person) =>
  ({
    USER_STATE_ACTIVE: "Active",
    USER_STATE_INACTIVE: "Suspended",
    USER_STATE_INITIAL: "Pending",
    USER_STATE_LOCKED: "Locked",
  })[user.state || ""] || "Unknown";

function PreviewAccountPage(
  handle: Handle<{ user: Person; context: Context }>,
) {
  return () => {
    const { user, context } = handle.props;
    return (
      <Document {...context} title="Account" active="account">
        <div class="page-heading">
          <div>
            <h1>Account</h1>
          </div>
        </div>
        <dl class="profile">
          <div>
            <dt>Name</dt>
            <dd>{nameOf(user)}</dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd>{user.userName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.human?.email?.email || "Not set"}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{statusOf(user)}</dd>
          </div>
        </dl>
      </Document>
    );
  };
}

function InactivePreviewPage(
  handle: Handle<{ user: Person; context: Context }>,
) {
  return () => {
    const { user, context } = handle.props;
    return (
      <Document {...context} title="Account unavailable">
        <div class="page-heading">
          <div>
            <h1>Account unavailable</h1>
            <p class="muted">
              {nameOf(user)} cannot sign in while this account is{" "}
              {statusOf(user).toLowerCase()}.
            </p>
          </div>
        </div>
      </Document>
    );
  };
}

function ActivityPage(
  handle: Handle<{ operations: Operation[]; context: Context }>,
) {
  return () => {
    const { operations, context } = handle.props;
    const applied = operations.filter((entry) => entry.state !== "review");
    return (
      <Document {...context} title="Activity & cleanup" active="activity">
        <div class="page-heading">
          <div>
            <h1>Activity & cleanup</h1>
            <p class="muted">
              Changes, verified outcomes, and work that still needs attention.
            </p>
          </div>
        </div>
        <div class="people-list">
          {applied.length ? (
            applied.map((entry) => (
              <a class="operation-row" href={`/manage/operations/${entry.id}`}>
                <span>
                  <strong>{entry.reason}</strong>
                  <span class="muted">
                    {new Date(entry.created_at).toLocaleString("en-GB", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </span>
                </span>
                <span class="status-label">
                  {entry.state.replaceAll("-", " ")}
                </span>
              </a>
            ))
          ) : (
            <p class="empty">No changes applied yet.</p>
          )}
        </div>
      </Document>
    );
  };
}

function OperationPage(handle: Handle<{ value: Operation; context: Context }>) {
  return () => {
    const { value, context } = handle.props;
    return (
      <Document {...context} title="Access operation" active="activity">
        <div class="page-heading">
          <div>
            <h1>Access operation</h1>
            <p class="muted">{value.reason}</p>
          </div>
        </div>
        <p>
          <span class="status-label">{value.state.replaceAll("-", " ")}</span>
        </p>
        {value.state === "unknown" ? (
          <>
            <p class="notice">
              The provider outcome is uncertain. Do not repeat this change.
              Inspect the native result without retrying writes.
            </p>
            <form
              method="post"
              action={`/manage/operations/${value.id}/reconcile`}
              class="form-stack"
            >
              <input type="hidden" name="csrf" value={context.csrf} />
              <button>Verify native outcome</button>
            </form>
          </>
        ) : null}
        <p>
          {value.body.completed?.length || 0} of {value.body.effects.length}{" "}
          native changes verified.
        </p>
        <section class="detail-section">
          <h2>External cleanup</h2>
          {value.body.cleanup?.length ? (
            value.body.cleanup.map((item, index) => (
              <div class="cleanup-item">
                <p>{item.note}</p>
                <span class="status-label">{item.state}</span>
                {item.state !== "verified" ? (
                  <form
                    method="post"
                    action={`/manage/operations/${value.id}/cleanup`}
                    class="form-stack"
                  >
                    <input type="hidden" name="csrf" value={context.csrf} />
                    <input type="hidden" name="index" value={String(index)} />
                    <label>
                      What was checked or cleaned?
                      <textarea
                        name="note"
                        required
                        maxLength={1000}
                        rows={2}
                      ></textarea>
                    </label>
                    <button>Record verified cleanup</button>
                  </form>
                ) : null}
              </div>
            ))
          ) : (
            <p class="muted">No removal cleanup recorded for this operation.</p>
          )}
        </section>
        <a class="text-link" href="/manage/activity">
          Activity & cleanup
        </a>
      </Document>
    );
  };
}

export const renderPreviewAccount = (
  user: Person,
  context: Context,
  nonce: string,
) =>
  renderToString(<PreviewAccountPage user={user} context={context} />, {
    nonce,
  });
export const renderInactivePreview = (
  user: Person,
  context: Context,
  nonce: string,
) =>
  renderToString(<InactivePreviewPage user={user} context={context} />, {
    nonce,
  });
export const renderActivity = (
  operations: Operation[],
  context: Context,
  nonce: string,
) =>
  renderToString(<ActivityPage operations={operations} context={context} />, {
    nonce,
  });
export const renderOperation = (
  value: Operation,
  context: Context,
  nonce: string,
) =>
  renderToString(<OperationPage value={value} context={context} />, { nonce });
