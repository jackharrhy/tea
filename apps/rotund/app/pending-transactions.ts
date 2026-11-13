import type { Session } from "remix/session";

import type { Transaction } from "./identity.js";

const key = "pendingTransactions";
const maxAge = 600_000;
const maxPending = 4;

function pending(session: Session): Transaction[] {
  const value: unknown = session.get(key);
  return Array.isArray(value)
    ? value.filter(
        (tx): tx is Transaction =>
          tx !== null &&
          typeof tx === "object" &&
          typeof tx.state === "string" &&
          typeof tx.nonce === "string" &&
          typeof tx.verifier === "string" &&
          typeof tx.createdAt === "number" &&
          typeof tx.silent === "boolean",
      )
    : [];
}

function fresh(tx: Transaction, now: number) {
  return tx.createdAt <= now && now - tx.createdAt <= maxAge;
}

export function addPendingTransaction(session: Session, tx: Transaction) {
  const now = Date.now();
  session.set(
    key,
    [...pending(session).filter((item) => fresh(item, now)), tx].slice(
      -maxPending,
    ),
  );
}

export function consumePendingTransaction(
  session: Session,
  state: string | null,
): Transaction | undefined {
  if (!state) return undefined;
  const now = Date.now();
  const transactions = pending(session);
  const tx = transactions.find((item) => item.state === state);
  if (!tx || !fresh(tx, now)) return undefined;
  session.set(
    key,
    transactions.filter((item) => item !== tx && fresh(item, now)),
  );
  return tx;
}
