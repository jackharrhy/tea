import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { OperatorStore } from "@tea/cms-operator/store.ts";

const email = process.env.TEA_OPERATOR_EMAIL?.trim().toLowerCase();
const password = process.env.TEA_OPERATOR_PASSWORD;
if (!email || !password || password.length < 16)
  throw new Error(
    "Set TEA_OPERATOR_EMAIL and TEA_OPERATOR_PASSWORD (16+ characters) to create an operator.",
  );
const store = new OperatorStore(
  resolve(process.env.TEA_DATA_DIR ?? "data", "operator", "operator.db"),
);
try {
  if (
    store.sqlite.prepare("SELECT id FROM users WHERE lower(email)=?").get(email)
  )
    throw new Error("Operator already exists; credentials were not replaced.");
  store.sqlite
    .prepare("INSERT INTO users(email,password_hash) VALUES (?,?)")
    .run(email, await bcrypt.hash(password, 12));
  console.log("Operator created.");
} finally {
  store.close();
}
