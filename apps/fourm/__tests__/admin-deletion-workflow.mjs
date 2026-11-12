import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { coreTables } from "../app/data/schema.ts";
const stateTool = fileURLToPath(
  new URL("./admin-deletion-state.py", import.meta.url),
);
function run(args, input) {
  const result = spawnSync("python3", [stateTool, ...args], {
    input: input ? JSON.stringify(input) : undefined,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    "Read-only deletion accounting failed; private tool assertion",
  );
  return JSON.parse(result.stdout);
}
export async function exerciseAdminDeletion({
  page,
  context,
  origin,
  name,
  output,
  oracleRoot,
  authPath,
  restart,
}) {
  const auth = JSON.parse(await readFile(authPath, "utf8"));
  const canonicalOracle =
    "/home/jack/.local/state/form-harrhy-integration/candidate/python-oracle";
  const plan = run([
    "plan",
    join(dirname(authPath), "review.sqlite3"),
    String(auth.userId),
    canonicalOracle,
  ]);
  await writeFile(
    output + "/deletion-plan.json",
    JSON.stringify(plan, null, 2),
  );
  const snapshot = () =>
    run(["snapshot", name, output, oracleRoot], { tables: coreTables, auth });
  const before = snapshot();
  await writeFile(
    output + `/${name}-before.json`,
    JSON.stringify(before, null, 2),
  );
  const denied = await context.request.post(
    origin + `/admin/users/${auth.userId}/delete`,
    { headers: { Origin: origin }, form: { mode: "reparent" } },
  );
  assert.equal(denied.status(), 400);
  page.on("dialog", (dialog) => dialog.accept());
  for (const item of plan.cases) {
    await page.goto(origin + "/admin");
    const row = page.locator(`#user-row-${item.id}`);
    assert.equal(await row.count(), 1);
    await row.locator(":scope > summary").click();
    const form = row.locator('form[action$="/delete"]').filter({
      has: page.locator(`input[name="mode"][value="${item.mode}"]`),
    });
    const pending = page.waitForResponse(
      (r) =>
        r.url() === origin + `/admin/users/${item.id}/delete` &&
        r.request().method() === "POST",
    );
    await form
      .getByRole("button", {
        name: item.mode === "prune" ? "prune tree" : "delete",
        exact: true,
      })
      .click();
    const response = await pending;
    await writeFile(
      output + `/${name}-${item.mode}-response.json`,
      JSON.stringify(
        { status: response.status(), body: await response.text() },
        null,
        2,
      ),
    );
    assert.equal(response.status(), 200);
    assert.ok(
      (await response.text()).includes(`deleted ${item.count} user(s)`),
    );
    await row.waitFor({ state: "detached" });
  }
  let after = snapshot();
  for (let attempt = 0; after.pendingObjects && attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    after = snapshot();
  }
  assert.equal(after.pendingObjects, 0, "Native R2 cleanup did not finish");
  assert.deepEqual(after.users, plan.expectedUsers);
  assert.deepEqual(
    after.counters,
    before.counters.filter((row) => !plan.deleted.includes(row.user_id)),
    "Surviving counters changed during deletion",
  );
  await writeFile(
    output + `/${name}-after.json`,
    JSON.stringify(after, null, 2),
  );
  for (const media of plan.media) {
    const url =
      origin +
      "/uploads/" +
      media.storage_path.split("/").map(encodeURIComponent).join("/");
    const response = await context.request.get(url);
    if (plan.deleted.includes(media.user_id))
      assert.equal(response.status(), 404);
    else {
      assert.equal(response.status(), 200);
      assert.equal(
        createHash("sha256")
          .update(await response.body())
          .digest("hex"),
        media.sha256,
      );
    }
    await response.dispose();
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + "/admin");
    await page.screenshot({
      path: output + `/${name}-deleted-admin-${width}.png`,
      fullPage: false,
    });
  }
  await restart(name);
  await page.goto(origin + "/admin");
  const recovered = snapshot();
  assert.deepEqual(recovered.tables, after.tables);
  assert.equal(recovered.pendingObjects, 0);
  await writeFile(
    output + `/${name}-deletion-receipt.json`,
    JSON.stringify(
      {
        status: "PASS",
        cases: plan.cases.map(({ mode, count }) => ({ mode, count })),
        deletedMembers: plan.deleted.length,
        survivingMembers: after.users.length,
        survivingMedia: plan.media.filter(
          (m) => !plan.deleted.includes(m.user_id),
        ).length,
        deletedMedia: plan.media.filter((m) => plan.deleted.includes(m.user_id))
          .length,
        allSurvivingMediaBytes: true,
        deletedMediaHTTP404: true,
        exactExpectedInviterGraph: true,
        cleanupObjects: 0,
        coldRestart: true,
        integrity: true,
        foreignKeys: true,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
  if (name === "native") {
    const source = JSON.parse(
      await readFile(output + "/oracle-after.json", "utf8"),
    );
    const nativeBefore = JSON.parse(
      await readFile(output + "/native-before.json", "utf8"),
    );
    const sourceBefore = JSON.parse(
      await readFile(output + "/oracle-before.json", "utf8"),
    );
    for (const table of coreTables) {
      if (
        table === "visitor_counters" &&
        JSON.stringify(nativeBefore.tables[table]) !==
          JSON.stringify(sourceBefore.tables[table])
      )
        continue;
      assert.deepEqual(
        after.tables[table],
        source.tables[table],
        "Post-deletion Source/native table differs: " + table,
      );
    }
    await writeFile(
      output + "/paired-deletion.json",
      JSON.stringify(
        {
          status: "PASS_BOUNDED",
          exactSourceNativeTables: coreTables.filter(
            (t) => t !== "visitor_counters",
          ),
          visitorCounterPolicy:
            "Surviving counters exactly unchanged in each app; preexisting cross-app counter drift remains a separate parity gap",
          productionTouched: false,
        },
        null,
        2,
      ),
    );
  }
}
