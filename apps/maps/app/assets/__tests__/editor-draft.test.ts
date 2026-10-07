import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  parseMapSource,
  planMapSave,
  serializeMap,
} from "@tea/maps-editor/core";
import {
  createEditorCheckpoint,
  latestEditorVersion,
  listEditorVersions,
  loadEditorDraft,
  saveEditorDraft,
  setEditorVersionProtected,
  type EditorDraft,
} from "../editor-draft.ts";

const draft: EditorDraft = {
  documentId: "map-one",
  fileName: "one.map",
  committedSource: "committed",
  workingSource: "working",
  revision: 1,
};

beforeEach(async () => {
  await deleteDB("tea-maps-editor");
});

describe("local editor recovery", () => {
  it("migrates the existing current draft when opening the history store", async () => {
    const database = await openDB("tea-maps-editor", 1, {
      upgrade(connection) {
        connection.createObjectStore("drafts");
      },
    });
    await database.put(
      "drafts",
      {
        committedSource: "old committed",
        workingSource: "old working",
      },
      "current",
    );
    database.close();

    const restored = await loadEditorDraft();
    expect(restored).toMatchObject({
      fileName: "tea-map.map",
      committedSource: "old committed",
      workingSource: "old working",
    });
    await saveEditorDraft(restored!);
    expect((await loadEditorDraft())?.documentId).toBe(restored?.documentId);
    expect(await listEditorVersions()).toHaveLength(1);
  });

  it("retains twenty automatic versions and keeps protected checkpoints", async () => {
    const checkpoint = await createEditorCheckpoint(draft, "Before edits");
    for (let revision = 1; revision <= 22; revision++) {
      await saveEditorDraft({
        ...draft,
        committedSource: `source ${revision}`,
        workingSource: `source ${revision}`,
        revision,
      });
    }
    const versions = await listEditorVersions();
    expect(versions).toHaveLength(21);
    expect(
      versions.find((version) => version.id === checkpoint.id),
    ).toMatchObject({
      label: "Before edits",
      protected: true,
    });
    expect(
      versions.some((version) => version.committedSource === "source 1"),
    ).toBe(false);
    expect((await loadEditorDraft())?.committedSource).toBe("source 22");
    expect((await latestEditorVersion(draft.documentId))?.committedSource).toBe(
      "source 22",
    );

    await setEditorVersionProtected(checkpoint.id, false);
    expect(
      (await listEditorVersions()).some(
        (version) => version.id === checkpoint.id,
      ),
    ).toBe(false);
  });

  it("keeps history separate for different documents and deduplicates unchanged drafts", async () => {
    await saveEditorDraft(draft);
    await saveEditorDraft(draft);
    await saveEditorDraft({
      ...draft,
      documentId: "map-two",
      fileName: "two.map",
    });
    expect(
      (await listEditorVersions())
        .map((version) => version.fileName)
        .toSorted(),
    ).toEqual(["one.map", "two.map"]);
  });

  it("recovers a standalone map's game profile when its source is unchanged", async () => {
    await saveEditorDraft({ ...draft, game: "quake2" });
    await saveEditorDraft({ ...draft, game: "gower" });

    expect((await loadEditorDraft())?.game).toBe("gower");
    expect((await listEditorVersions()).map((version) => version.game)).toEqual(
      ["gower", "quake2"],
    );
  });

  it("retains source anchors across recovery for source-preserving saves", async () => {
    const original = '// retained header\n{\n"classname" "worldspawn"\n}\n';
    const parsed = parseMapSource(original);
    const document = {
      ...parsed.document,
      revision: 1,
      entities: parsed.document.entities.map((entity) => ({
        ...entity,
        properties: { ...entity.properties, message: "edited" },
      })),
    };
    const plan = planMapSave(document, parsed.source);
    expect(plan.status).toBe("safe");
    await saveEditorDraft({
      ...draft,
      committedSource: serializeMap(document),
      workingSource: plan.status === "safe" ? plan.text : "",
      document,
      sourceState: parsed.source,
    });

    const restored = await loadEditorDraft();
    expect(restored?.document).toBeDefined();
    expect(restored?.sourceState).toBeDefined();
    const afterRecovery = planMapSave(
      restored!.document!,
      restored!.sourceState!,
    );
    expect(afterRecovery).toMatchObject({ status: "safe" });
    if (afterRecovery.status === "safe") {
      expect(afterRecovery.text).toContain("// retained header");
      expect(afterRecovery.text).toContain('"message" "edited"');
    }
  });
});
