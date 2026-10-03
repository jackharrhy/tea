import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { adoptSite } from "../packages/teacms/app/data/adopt.ts";

const [andrewRoot, lukeRoot] = process.argv.slice(2);
if (!andrewRoot || !lukeRoot || process.argv.length !== 4)
  throw new Error(
    "Usage: npm run tea:adopt-local -- /path/to/andrew-gosse-site /path/to/luke-blackmore-site",
  );

const dataRoot = resolve(process.env.TEA_DATA_DIR ?? "data");
for (const id of ["andrew", "luke"])
  if (existsSync(join(dataRoot, id)))
    throw new Error(
      `Destination data/${id} already exists; nothing was replaced.`,
    );

await mkdir(dataRoot, { recursive: true });
const staging = await mkdtemp(join(dataRoot, ".adopt-"));
const published: string[] = [];
try {
  const andrew = await adoptSite(
    join(resolve(andrewRoot), "data"),
    join(staging, "andrew"),
  );
  const luke = await adoptSite(
    join(resolve(lukeRoot), "data"),
    join(staging, "luke"),
  );

  const andrewPublic = join(staging, "andrew", "public");
  const lukePublic = join(staging, "luke", "public");
  await mkdir(andrewPublic);
  await mkdir(lukePublic);
  await copyFile(
    join(resolve(andrewRoot), "public", "favicon.png"),
    join(andrewPublic, "favicon.png"),
  );
  await copyFile(
    join(resolve(lukeRoot), "public", "favicon.ico"),
    join(lukePublic, "favicon.ico"),
  );
  await copyFile(
    join(resolve(lukeRoot), "public", "site.css"),
    join(lukePublic, "site.css"),
  );
  await cp(
    join(resolve(lukeRoot), "public", "fonts"),
    join(lukePublic, "fonts"),
    { recursive: true },
  );

  for (const id of ["andrew", "luke"]) {
    const destination = join(dataRoot, id);
    if (existsSync(destination))
      throw new Error(`Destination data/${id} appeared during adoption.`);
    await rename(join(staging, id), destination);
    published.push(destination);
  }
  console.log(JSON.stringify({ andrew, luke }, null, 2));
  console.log("Both sites adopted. Existing sessions were omitted.");
} catch (error) {
  for (const destination of published)
    await rm(destination, { recursive: true, force: true });
  throw error;
} finally {
  await rm(staging, { recursive: true, force: true });
}
