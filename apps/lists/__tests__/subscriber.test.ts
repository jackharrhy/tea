import { test, expect, describe } from "bun:test";
import { createTestDb, seedList } from "./helpers";
import {
  createSubscriber,
  confirmSubscriber,
  unsubscribeAll,
  unsubscribeFromList,
  getSubscriberPreferences,
  updatePreferences,
  getConfirmedSubscribers,
} from "../src/services/subscriber";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";

describe("createSubscriber", () => {
  test("creates a new subscriber with normalized email (lowercase, trimmed)", () => {
    const db = createTestDb();
    seedList(db, { slug: "news" });

    const subscriber = createSubscriber(
      db,
      "  Alice@Example.COM  ",
      "Alice",
      null,
      ["news"],
    );

    expect(subscriber.email).toBe("alice@example.com");
    expect(subscriber.firstName).toBe("Alice");
  });

  test("generates an unsubscribeToken", () => {
    const db = createTestDb();
    seedList(db, { slug: "news" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);

    expect(subscriber.unsubscribeToken).toBeDefined();
    expect(subscriber.unsubscribeToken.length).toBeGreaterThan(0);
  });

  test("subscribes to requested lists by slug as unconfirmed", () => {
    const db = createTestDb();
    const list = seedList(db, { slug: "news", name: "News" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);

    const subList = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, list.id),
        ),
      )
      .get();

    expect(subList).toBeDefined();
    expect(subList!.status).toBe("unconfirmed");
  });

  test("returns existing subscriber if email already exists", () => {
    const db = createTestDb();
    seedList(db, { slug: "news" });

    const first = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);
    const second = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);

    expect(second.id).toBe(first.id);

    const allSubscribers = db.select().from(schema.subscribers).all();
    expect(allSubscribers).toHaveLength(1);
  });

  test("handles subscribing to multiple lists", () => {
    const db = createTestDb();
    seedList(db, { slug: "news", name: "News" });
    seedList(db, {
      slug: "updates",
      name: "Updates",
    });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
      "updates",
    ]);

    const subLists = db
      .select()
      .from(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
      .all();

    expect(subLists).toHaveLength(2);
    expect(subLists.every((sl) => sl.status === "unconfirmed")).toBe(true);
  });

  test("moves an unsubscribed list back to unconfirmed when resubscribing", () => {
    const db = createTestDb();
    const list = seedList(db, { slug: "news" });
    const subscriber = createSubscriber(
      db,
      "returning@example.com",
      null,
      null,
      ["news"],
    );
    confirmSubscriber(db, subscriber.unsubscribeToken);
    unsubscribeFromList(db, subscriber.unsubscribeToken, list.id);

    createSubscriber(db, "returning@example.com", null, null, ["news"]);

    const subscription = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, list.id),
        ),
      )
      .get();
    expect(subscription!.status).toBe("unconfirmed");
  });

  test("rejects unknown list slugs without creating a subscriber", () => {
    const db = createTestDb();

    expect(() =>
      createSubscriber(db, "lost@example.com", null, null, ["does-not-exist"]),
    ).toThrow("Unknown list slug");
    expect(db.select().from(schema.subscribers).all()).toHaveLength(0);
  });

  test("rolls back the subscriber and event when membership creation fails", () => {
    const db = createTestDb();
    seedList(db, { slug: "news" });
    db.run(
      sql.raw(`
      CREATE TRIGGER reject_membership
      BEFORE INSERT ON subscriber_lists
      BEGIN
        SELECT RAISE(ABORT, 'membership rejected');
      END
    `),
    );

    expect(() =>
      createSubscriber(db, "rollback@example.com", null, null, ["news"]),
    ).toThrow("membership rejected");
    expect(db.select().from(schema.subscribers).all()).toEqual([]);
    expect(db.select().from(schema.events).all()).toEqual([]);
  });
});

describe("confirmSubscriber", () => {
  test("updates all unconfirmed subscriberLists to confirmed", () => {
    const db = createTestDb();
    seedList(db, { slug: "news", name: "News" });
    seedList(db, { slug: "updates", name: "Updates" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
      "updates",
    ]);
    confirmSubscriber(db, subscriber.unsubscribeToken);

    const subLists = db
      .select()
      .from(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
      .all();

    expect(subLists).toHaveLength(2);
    expect(subLists.every((sl) => sl.status === "confirmed")).toBe(true);
  });

  test("returns true on success", () => {
    const db = createTestDb();
    seedList(db, { slug: "news" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);
    const result = confirmSubscriber(db, subscriber.unsubscribeToken);

    expect(result).toBe(true);
  });

  test("returns false for invalid token", () => {
    const db = createTestDb();
    const result = confirmSubscriber(db, "invalid-token-xyz");

    expect(result).toBe(false);
  });
});

describe("unsubscribeAll", () => {
  test("keeps subscriber status as active (per-list only)", () => {
    const db = createTestDb();
    seedList(db, { slug: "news" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);
    unsubscribeAll(db, subscriber.unsubscribeToken);

    const updated = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, subscriber.id))
      .get();

    expect(updated!.status).toBe("active");
  });

  test("updates all subscriberLists to unsubscribed", () => {
    const db = createTestDb();
    seedList(db, { slug: "news", name: "News" });
    seedList(db, { slug: "updates", name: "Updates" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
      "updates",
    ]);
    unsubscribeAll(db, subscriber.unsubscribeToken);

    const subLists = db
      .select()
      .from(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
      .all();

    expect(subLists).toHaveLength(2);
    expect(subLists.every((sl) => sl.status === "unsubscribed")).toBe(true);
  });

  test("returns true on success", () => {
    const db = createTestDb();
    seedList(db, { slug: "news" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);
    const result = unsubscribeAll(db, subscriber.unsubscribeToken);

    expect(result).toBe(true);
  });

  test("returns false for invalid token", () => {
    const db = createTestDb();
    const result = unsubscribeAll(db, "invalid-token-xyz");

    expect(result).toBe(false);
  });
});

describe("getSubscriberPreferences", () => {
  test("returns subscriber and list subscription status", () => {
    const db = createTestDb();
    seedList(db, { slug: "news", name: "News" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);
    const prefs = getSubscriberPreferences(db, subscriber.unsubscribeToken);

    expect(prefs).not.toBeNull();
    expect(prefs!.subscriber.id).toBe(subscriber.id);
    expect(prefs!.lists).toHaveLength(1);
    expect(prefs!.lists[0].slug).toBe("news");
    expect(prefs!.lists[0].subscriptionStatus).toBe("unconfirmed");
  });

  test("returns null for invalid token", () => {
    const db = createTestDb();
    const result = getSubscriberPreferences(db, "invalid-token-xyz");

    expect(result).toBeNull();
  });
});

describe("updatePreferences", () => {
  test("subscribes to new lists", () => {
    const db = createTestDb();
    const list1 = seedList(db, { slug: "news", name: "News" });
    const list2 = seedList(db, { slug: "updates", name: "Updates" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);

    updatePreferences(db, subscriber.unsubscribeToken, [list1.id, list2.id]);

    const subLists = db
      .select()
      .from(schema.subscriberLists)
      .where(eq(schema.subscriberLists.subscriberId, subscriber.id))
      .all();

    expect(subLists).toHaveLength(2);
    // The original "news" subscription gets set to confirmed, and "updates" is newly inserted as confirmed
    const updatesEntry = subLists.find((sl) => sl.listId === list2.id);
    expect(updatesEntry).toBeDefined();
    expect(updatesEntry!.status).toBe("confirmed");
  });

  test("unsubscribes from unchecked lists", () => {
    const db = createTestDb();
    const list1 = seedList(db, { slug: "news", name: "News" });
    const list2 = seedList(db, { slug: "updates", name: "Updates" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
      "updates",
    ]);
    confirmSubscriber(db, subscriber.unsubscribeToken);

    // Only keep list1, drop list2
    updatePreferences(db, subscriber.unsubscribeToken, [list1.id]);

    const updatesEntry = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, list2.id),
        ),
      )
      .get();

    expect(updatesEntry!.status).toBe("unsubscribed");
  });

  test("re-subscribes to previously unsubscribed lists", () => {
    const db = createTestDb();
    const list = seedList(db, { slug: "news", name: "News" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);
    confirmSubscriber(db, subscriber.unsubscribeToken);

    // Unsubscribe from list
    updatePreferences(db, subscriber.unsubscribeToken, []);

    const unsubbed = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, list.id),
        ),
      )
      .get();
    expect(unsubbed!.status).toBe("unsubscribed");

    // Re-subscribe
    updatePreferences(db, subscriber.unsubscribeToken, [list.id]);

    const resubbed = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, list.id),
        ),
      )
      .get();
    expect(resubbed!.status).toBe("confirmed");
  });
});

describe("unsubscribeFromList", () => {
  test("unsubscribes from a specific list only", () => {
    const db = createTestDb();
    const listA = seedList(db, { slug: "list-a", name: "List A" });
    const listB = seedList(db, { slug: "list-b", name: "List B" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "list-a",
      "list-b",
    ]);
    confirmSubscriber(db, subscriber.unsubscribeToken);

    const result = unsubscribeFromList(
      db,
      subscriber.unsubscribeToken,
      listA.id,
    );
    expect(result).toBe(true);

    const subListA = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, listA.id),
        ),
      )
      .get();
    expect(subListA!.status).toBe("unsubscribed");

    const subListB = db
      .select()
      .from(schema.subscriberLists)
      .where(
        and(
          eq(schema.subscriberLists.subscriberId, subscriber.id),
          eq(schema.subscriberLists.listId, listB.id),
        ),
      )
      .get();
    expect(subListB!.status).toBe("confirmed");

    const updated = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, subscriber.id))
      .get();
    expect(updated!.status).toBe("active");
  });

  test("keeps subscriber active when no active subs remain (per-list only)", () => {
    const db = createTestDb();
    seedList(db, { slug: "list-a", name: "List A" });
    const listA = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "list-a"))
      .get()!;

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "list-a",
    ]);
    confirmSubscriber(db, subscriber.unsubscribeToken);

    unsubscribeFromList(db, subscriber.unsubscribeToken, listA.id);

    const updated = db
      .select()
      .from(schema.subscribers)
      .where(eq(schema.subscribers.id, subscriber.id))
      .get();
    expect(updated!.status).toBe("active");
  });

  test("returns false for invalid token", () => {
    const db = createTestDb();
    seedList(db, { slug: "list-a", name: "List A" });
    const listA = db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.slug, "list-a"))
      .get()!;

    const result = unsubscribeFromList(db, "fake-token-xyz", listA.id);
    expect(result).toBe(false);
  });

  test("returns false for non-existent list", () => {
    const db = createTestDb();
    seedList(db, { slug: "list-a", name: "List A" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "list-a",
    ]);

    const result = unsubscribeFromList(db, subscriber.unsubscribeToken, 99999);
    expect(result).toBe(false);
  });
});

describe("confirmSubscriber dedup", () => {
  test("does not log duplicate event on second confirm", () => {
    const db = createTestDb();
    seedList(db, { slug: "news", name: "News" });

    const subscriber = createSubscriber(db, "bob@example.com", "Bob", null, [
      "news",
    ]);

    confirmSubscriber(db, subscriber.unsubscribeToken);
    confirmSubscriber(db, subscriber.unsubscribeToken);

    const events = db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.type, "subscriber.confirmed"),
          eq(schema.events.subscriberId, subscriber.id),
        ),
      )
      .all();

    expect(events).toHaveLength(1);
  });
});

describe("Tag CRUD", () => {
  test("can create tag, link to subscriber, and delete the link without deleting the tag", () => {
    const db = createTestDb();

    // Insert a tag
    const tag = db
      .insert(schema.tags)
      .values({ name: "beta-testers" })
      .returning()
      .get();
    expect(tag.id).toBeDefined();
    expect(tag.name).toBe("beta-testers");

    // Create a subscriber
    seedList(db, { slug: "news" });
    const sub = createSubscriber(db, "tester@example.com", "Tester", null, [
      "news",
    ]);

    // Link subscriber to tag
    db.insert(schema.subscriberTags)
      .values({ subscriberId: sub.id, tagId: tag.id })
      .run();

    // Verify link exists
    const links = db
      .select()
      .from(schema.subscriberTags)
      .where(
        and(
          eq(schema.subscriberTags.subscriberId, sub.id),
          eq(schema.subscriberTags.tagId, tag.id),
        ),
      )
      .all();
    expect(links).toHaveLength(1);
    expect(links[0].subscriberId).toBe(sub.id);
    expect(links[0].tagId).toBe(tag.id);

    // Delete the link
    db.delete(schema.subscriberTags)
      .where(
        and(
          eq(schema.subscriberTags.subscriberId, sub.id),
          eq(schema.subscriberTags.tagId, tag.id),
        ),
      )
      .run();

    // Verify link is gone
    const linksAfter = db
      .select()
      .from(schema.subscriberTags)
      .where(
        and(
          eq(schema.subscriberTags.subscriberId, sub.id),
          eq(schema.subscriberTags.tagId, tag.id),
        ),
      )
      .all();
    expect(linksAfter).toHaveLength(0);

    // Verify tag still exists
    const tagStillExists = db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.id, tag.id))
      .get();
    expect(tagStillExists).toBeDefined();
    expect(tagStillExists!.name).toBe("beta-testers");
  });
});

describe("getConfirmedSubscribers", () => {
  test("returns only active + confirmed subscribers for a list", () => {
    const db = createTestDb();
    const list = seedList(db, { slug: "news", name: "News" });

    const sub1 = createSubscriber(
      db,
      "confirmed@example.com",
      "Confirmed",
      null,
      ["news"],
    );
    confirmSubscriber(db, sub1.unsubscribeToken);

    // sub2 is unconfirmed — should not appear
    createSubscriber(db, "unconfirmed@example.com", "Unconfirmed", null, [
      "news",
    ]);

    const confirmed = getConfirmedSubscribers(db, list.id);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].email).toBe("confirmed@example.com");
  });

  test("excludes unsubscribed subscribers", () => {
    const db = createTestDb();
    const list = seedList(db, { slug: "news", name: "News" });

    const sub1 = createSubscriber(db, "active@example.com", "Active", null, [
      "news",
    ]);
    confirmSubscriber(db, sub1.unsubscribeToken);

    const sub2 = createSubscriber(db, "unsub@example.com", "Unsub", null, [
      "news",
    ]);
    confirmSubscriber(db, sub2.unsubscribeToken);
    unsubscribeAll(db, sub2.unsubscribeToken);

    const confirmed = getConfirmedSubscribers(db, list.id);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].email).toBe("active@example.com");
  });
});
