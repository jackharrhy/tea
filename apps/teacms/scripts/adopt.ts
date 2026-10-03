import { adoptSite } from "../packages/teacms/app/data/adopt.ts";
const [source, target] = process.argv.slice(2);
if (!source || !target)
  throw new Error("Usage: npm run tea:adopt -- /backup/site /new/data/site-id");
console.log(await adoptSite(source, target));
console.log(
  "Adopted into a separate directory. Existing sessions were omitted; editors must sign in again.",
);
