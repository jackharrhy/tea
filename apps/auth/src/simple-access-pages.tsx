import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { uiPrimaryActionStyles } from "@harrhy/ui";
import { Document, type DocumentProps } from "./document.tsx";
import {
  listRowStyles,
  operationRowStyles,
  personInitialStyles,
} from "./list-row-styles.ts";

type AccessContext = Omit<DocumentProps, "title" | "children"> & {
  csrf: string;
};

type Session = { id: string; expirationDate: string };

function SessionsPage(
  handle: Handle<{ items: Session[]; current: string; context: AccessContext }>,
) {
  return () => {
    const { items, current, context } = handle.props;
    return (
      <Document {...context} title="Sessions" active="account">
        <div class="page-heading">
          <div>
            <h1>Sessions</h1>
            <p class="muted">
              Your central sign-ins. Ending one does not sign you out of every
              app.
            </p>
          </div>
        </div>
        <div class="people-list">
          {items.length ? (
            items.map((item) => (
              <div
                class="operation-row"
                mix={[listRowStyles, operationRowStyles]}
              >
                <span>
                  <strong>
                    {item.id === current
                      ? "This browser"
                      : "Central browser session"}
                  </strong>
                  <span class="muted">
                    Expires{" "}
                    {new Date(item.expirationDate).toLocaleString("en-GB", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </span>
                </span>
                <form
                  method="post"
                  action="/account/sessions/end"
                  class="form-stack"
                >
                  <input type="hidden" name="csrf" value={context.csrf} />
                  <input type="hidden" name="session" value={item.id} />
                  <button>End session</button>
                </form>
              </div>
            ))
          ) : (
            <p class="empty">No active central sessions.</p>
          )}
        </div>
        <a class="text-link" href="/account">
          Account
        </a>
      </Document>
    );
  };
}

type Person = {
  id: string;
  userName: string;
  state?: string;
  human?: { profile?: { displayName?: string } };
};

type PeopleModel = { memberships: { subject: string }[] };

const nameOf = (user: Person) =>
  user.human?.profile?.displayName || user.userName || "Person";
const statusOf = (user: Person) =>
  ({
    USER_STATE_ACTIVE: "Active",
    USER_STATE_INACTIVE: "Suspended",
    USER_STATE_INITIAL: "Pending",
    USER_STATE_LOCKED: "Locked",
  })[user.state || ""] || "Unknown";

function PeoplePage(
  handle: Handle<{
    users: Person[];
    model: PeopleModel;
    context: AccessContext;
    filter: { q: string; state: string };
  }>,
) {
  return () => {
    const { users, model, context, filter } = handle.props;
    const all = users.filter((user) => user.human);
    const shown = all.filter(
      (user) =>
        (filter.state === "all" ||
          (filter.state === "active"
            ? user.state === "USER_STATE_ACTIVE"
            : user.state !== "USER_STATE_ACTIVE")) &&
        `${nameOf(user)} ${user.userName}`
          .toLowerCase()
          .includes(filter.q.toLowerCase()),
    );
    return (
      <Document {...context} title="People" active="people">
        <div class="page-heading">
          <div>
            <h1>People</h1>
            <p class="muted">See who can use what, and why.</p>
          </div>
          <a class="button" href="/manage/people/new">
            Add person
          </a>
        </div>
        <form class="filters" method="get">
          <label>
            Find a person
            <input
              name="q"
              type="search"
              value={filter.q}
              placeholder="Name or username"
            />
          </label>
          <label>
            Account state
            <select name="state" value={filter.state}>
              <option value="all">All people</option>
              <option value="active">Active</option>
              <option value="other">Suspended or pending</option>
            </select>
          </label>
          <button>Find</button>
        </form>
        <p class="result-count">
          {shown.length} of {all.length} people
        </p>
        <div class="people-list">
          {shown.length ? (
            shown.map((user) => (
              <a
                class="person-row"
                mix={listRowStyles}
                href={`/manage/people/${encodeURIComponent(user.id)}`}
              >
                <span
                  class="person-initial"
                  mix={personInitialStyles}
                  aria-hidden="true"
                >
                  {nameOf(user).slice(0, 1)}
                </span>
                <span>
                  <strong>{nameOf(user)}</strong>
                  <span class="muted">{user.userName}</span>
                </span>
                <span>
                  <span class="status-label">{statusOf(user)}</span>
                </span>
                <span class="row-meta">
                  {
                    model.memberships.filter((item) => item.subject === user.id)
                      .length
                  }{" "}
                  groups
                </span>
                <span class="row-action">View access</span>
              </a>
            ))
          ) : (
            <p class="empty">No people match these filters.</p>
          )}
        </div>
      </Document>
    );
  };
}

function NewPersonPage(handle: Handle<{ context: AccessContext }>) {
  return () => (
    <Document {...handle.props.context} title="Add person" active="people">
      <div class="page-heading">
        <div>
          <h1>Add person</h1>
          <p class="muted">
            Create an identity. Service access is assigned separately.
          </p>
        </div>
      </div>
      <form method="post" action="/manage/users" class="form-stack">
        <input type="hidden" name="csrf" value={handle.props.context.csrf} />
        <label>
          Username
          <input
            name="username"
            required
            pattern="[a-z0-9_-]{2,32}"
            maxLength={32}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label>
          Display name
          <input name="name" required maxLength={100} />
        </label>
        <label>
          Email (optional)
          <input name="email" type="email" maxLength={250} />
        </label>
        <label>
          Initial password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={200}
            required
          />
        </label>
        <p class="muted">
          No invitation is sent. Share the initial password privately. Creating
          a person does not grant app access.
        </p>
        <button class="primary" mix={uiPrimaryActionStyles}>
          Create person
        </button>
      </form>
    </Document>
  );
}

export function renderSessions(
  items: Session[],
  current: string,
  context: AccessContext,
  nonce: string,
) {
  return renderToString(
    <SessionsPage items={items} current={current} context={context} />,
    { nonce },
  );
}

export function renderPeople(
  users: Person[],
  model: PeopleModel,
  context: AccessContext,
  filter: { q: string; state: string },
  nonce: string,
) {
  return renderToString(
    <PeoplePage
      users={users}
      model={model}
      context={context}
      filter={filter}
    />,
    { nonce },
  );
}

export function renderNewPerson(context: AccessContext, nonce: string) {
  return renderToString(<NewPersonPage context={context} />, { nonce });
}
