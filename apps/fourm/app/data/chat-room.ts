import { CommunityError } from "./community.ts";
import type { Database, Member } from "./community.ts";
type Presence = {
  username: string;
  state: "active" | "idle";
  connections: Map<string, number>;
};
type Event = { cursor: number; username: string; message: string };
export function createChatRoom(
  db: Database,
  member: (id: number) => Member,
  floodLimit = true,
) {
  const presence = new Map<number, Presence>();
  const history = new Map<number, number[]>();
  const timedOut = new Map<number, number>();
  const events: Event[] = [];
  const waiters = new Set<() => void>();
  let cursor = 0;
  function append(username: string, message: string) {
    events.push({ cursor: ++cursor, username, message });
    if (events.length > 200) events.splice(0, events.length - 200);
    for (const notify of waiters) notify();
  }
  function people() {
    const now = Date.now();
    for (const [id, person] of presence) {
      for (const [key, expires] of person.connections)
        if (expires <= now) person.connections.delete(key);
      if (
        !person.connections.size ||
        !db.all("SELECT id FROM users WHERE id=? AND is_disabled=0", id).length
      )
        presence.delete(id);
    }
    return [...presence.values()]
      .map(({ username, state }) => ({ username, state }))
      .toSorted((a, b) =>
        a.username < b.username ? -1 : a.username > b.username ? 1 : 0,
      );
  }
  function heartbeat(actorId: number | null, connection: string) {
    if (actorId === null) return;
    const actor = member(actorId);
    let person = presence.get(actorId);
    if (!person) {
      person = {
        username: actor.username,
        state: "active",
        connections: new Map(),
      };
      presence.set(actorId, person);
    }
    person.connections.set(connection, Date.now() + 60000);
  }
  return {
    chatHistory() {
      return db.all(
        "SELECT c.*,u.username FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100) c JOIN users u ON u.id=c.author_id ORDER BY c.id",
      );
    },
    openChat(actorId: number | null, connection: string) {
      heartbeat(actorId, connection);
      if (actorId !== null) presence.get(actorId)!.state = "active";
      return { cursor, presence: people() };
    },
    pollChat(actorId: number | null, connection: string, after: number) {
      heartbeat(actorId, connection);
      return {
        cursor,
        events: events.filter((event) => event.cursor > after),
        presence: people(),
      };
    },
    closeChat(actorId: number | null, connection: string) {
      if (actorId === null) return;
      const person = presence.get(actorId);
      person?.connections.delete(connection);
      if (!person?.connections.size) presence.delete(actorId);
    },
    updateChatPresence(actorId: number | null, active: boolean) {
      if (actorId === null) return;
      member(actorId);
      const person = presence.get(actorId);
      if (person) person.state = active ? "active" : "idle";
    },
    waitChat(after: number) {
      if (cursor !== after) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, 10000);
        waiters.add(done);
      });
    },
    sendChat(actorId: number, message: string) {
      const actor = member(actorId);
      const text = Array.from(message.trim()).slice(0, 500).join("");
      if (!text) throw new CommunityError(400, "empty message");
      const person = presence.get(actorId);
      if (person) person.state = "active";
      const now = Date.now();
      if (floodLimit && now < (timedOut.get(actorId) ?? 0)) {
        append(
          "system",
          `${actor.username} is timed out for ${Math.trunc(((timedOut.get(actorId) ?? 0) - now) / 1000)}s`,
        );
        return { status: "timed_out" as const };
      }
      const recent = (history.get(actorId) ?? []).filter(
        (time) => now - time < 30000,
      );
      if (floodLimit && recent.length >= 20) {
        timedOut.set(actorId, now + 60000);
        append("system", `${actor.username} has been timed out for flooding`);
        return { status: "timed_out" as const };
      }
      history.set(actorId, [...recent, now]);
      const row = db.all(
        "INSERT INTO chat_messages(author_id,message) VALUES(?,?) RETURNING id",
        actorId,
        text,
      )[0];
      append(actor.username, text);
      return { status: "sent" as const, id: Number(row.id) };
    },
  };
}
