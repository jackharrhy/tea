import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import * as Y from "yjs";

import {
  SocketHandler,
  type SocketHandlerOptions,
  type SocketHandlerTransport,
} from "../app/frontend/socket-handler.ts";
import { PROSEMIRROR_FRAGMENT_NAME } from "../app/shared/constants.ts";
import {
  MESSAGE_TYPE_AWARENESS,
  MESSAGE_TYPE_DELETE_FILE,
  MESSAGE_TYPE_ERROR,
  MESSAGE_TYPE_FILE_LIST,
  MESSAGE_TYPE_OPEN_FILE,
  MESSAGE_TYPE_RENAME_FILE,
  MESSAGE_TYPE_SUBDOC_SYNC,
} from "../app/shared/message-types.ts";
import {
  decodeFileMessage,
  decodeRenameFrame,
  decodeUtf8,
  encodeFileMessage,
  encodeMessage,
  encodeUtf8,
} from "../app/shared/wire.ts";

type Listener = (event: unknown) => void;

class FakeWebSocket implements SocketHandlerTransport {
  readyState = 1; // OPEN
  readonly sent: Uint8Array[] = [];
  private readonly listeners: Map<string, Listener[]> = new Map();

  addEventListener(type: string, listener: Listener): void {
    let list = this.listeners.get(type);
    if (!list) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(listener);
  }

  send(data: ArrayBuffer | ArrayBufferView | Uint8Array | string): void {
    if (typeof data === "string") return;
    const buf =
      data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    this.sent.push(new Uint8Array(buf));
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.fire("close", {});
  }

  // Test helpers ------------------------------------------------------------
  fire(type: string, event: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(event);
  }

  deliver(frame: Uint8Array): void {
    this.fire("message", {
      data: frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength,
      ),
    });
  }

  framesOfType(type: number): Uint8Array[] {
    return this.sent.filter((f) => f[0] === type);
  }
}

function makeHandler(overrides?: Partial<SocketHandlerOptions>) {
  const ws = new FakeWebSocket();
  const events: Record<string, unknown[]> = {
    fileList: [],
    subdoc: [],
    awareness: [],
    subdocAwareness: [],
    error: [],
  };
  const handler = new SocketHandler({
    socket: ws,
    onFileListUpdate: (files) => events.fileList.push(files),
    onSubdocUpdate: (filename) => events.subdoc.push(filename),
    onAwarenessUpdate: () => events.awareness.push(null),
    onSubdocAwarenessUpdate: (filename) =>
      events.subdocAwareness.push(filename),
    onError: (message) => events.error.push(message),
    ...overrides,
  });
  return { handler, ws, events };
}

describe("SocketHandler", () => {
  it("emits an initial awareness frame on the open event", () => {
    const { ws } = makeHandler();

    // Before open fires, no frames go out.
    assert.equal(ws.framesOfType(MESSAGE_TYPE_AWARENESS).length, 0);

    ws.fire("open", {});

    // On open the handler announces itself in awareness so peers see it.
    assert.ok(ws.framesOfType(MESSAGE_TYPE_AWARENESS).length >= 1);
  });

  it("openFile sends an OPEN_FILE frame with the filename", () => {
    const { ws, handler } = makeHandler();
    ws.fire("open", {});
    ws.sent.length = 0;

    handler.openFile("Notes.md");

    assert.equal(ws.sent.length, 1);
    assert.equal(ws.sent[0][0], MESSAGE_TYPE_OPEN_FILE);
    assert.equal(decodeUtf8(ws.sent[0].subarray(1)), "Notes.md");
  });

  it("renameFile sends a RENAME_FILE frame round-trippable by the wire decoder", () => {
    const { ws, handler } = makeHandler();
    ws.fire("open", {});
    ws.sent.length = 0;

    handler.renameFile("Jack.md", "Jack-Arthur.md");

    assert.equal(ws.sent.length, 1);
    assert.equal(ws.sent[0][0], MESSAGE_TYPE_RENAME_FILE);
    const { oldName, newName } = decodeRenameFrame(ws.sent[0].subarray(1));
    assert.equal(oldName, "Jack.md");
    assert.equal(newName, "Jack-Arthur.md");
  });

  it("deleteFile sends a DELETE_FILE frame", () => {
    const { ws, handler } = makeHandler();
    ws.fire("open", {});
    ws.sent.length = 0;

    handler.deleteFile("Old.md");

    assert.equal(ws.sent.length, 1);
    assert.equal(ws.sent[0][0], MESSAGE_TYPE_DELETE_FILE);
    assert.equal(decodeUtf8(ws.sent[0].subarray(1)), "Old.md");
  });

  it("inbound FILE_LIST frame fires onFileListUpdate", () => {
    const { ws, events } = makeHandler();
    ws.fire("open", {});

    ws.deliver(
      encodeMessage(MESSAGE_TYPE_FILE_LIST, encodeUtf8('["a.md","b.md"]')),
    );

    assert.equal(events.fileList.length, 1);
    assert.deepEqual(events.fileList[0], ["a.md", "b.md"]);
  });

  it("inbound ERROR frame fires onError with the message text", () => {
    const { ws, events } = makeHandler();
    ws.fire("open", {});

    ws.deliver(
      encodeMessage(MESSAGE_TYPE_ERROR, encodeUtf8("something broke")),
    );

    assert.deepEqual(events.error, ["something broke"]);
  });

  it("malformed FILE_LIST JSON does not crash the handler", () => {
    const { ws, events } = makeHandler();
    ws.fire("open", {});

    // Invalid JSON; handler should swallow the parse error.
    ws.deliver(encodeMessage(MESSAGE_TYPE_FILE_LIST, encodeUtf8("not json")));

    assert.equal(events.fileList.length, 0);
  });

  it("inbound SUBDOC_SYNC registers the subdoc and applies the update", () => {
    const { ws, handler, events } = makeHandler();
    ws.fire("open", {});

    // Seed the filesMap with the subdoc the way the server would: via a
    // SYNC frame for the root doc. Easier path: deliver the SUBDOC_SYNC
    // directly with a real Y.Doc state that contains some text.
    const sourceDoc = new Y.Doc();
    sourceDoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME); // create the fragment
    const update = Y.encodeStateAsUpdate(sourceDoc);

    // The handler needs the filename present in filesMap first. The server
    // puts it there via the root-doc SYNC frame. Simulate that by mutating
    // the handler's rootDoc directly.
    const filesMap = handler.rootDoc.getMap<Y.Doc>("files");
    filesMap.set("hello.md", new Y.Doc());

    ws.deliver(encodeFileMessage(MESSAGE_TYPE_SUBDOC_SYNC, "hello.md", update));

    assert.equal(events.subdoc[0], "hello.md");
    const local = handler.getSubdoc("hello.md");
    assert.ok(local, "handler should now have a local subdoc for hello.md");
  });

  it("locally-originated subdoc edits round-trip out as SUBDOC_SYNC frames", () => {
    const { ws, handler } = makeHandler();
    ws.fire("open", {});

    // Register a subdoc the same way OPEN_FILE/SUBDOC_SYNC would.
    const filesMap = handler.rootDoc.getMap<Y.Doc>("files");
    filesMap.set("shared.md", new Y.Doc());
    const seed = new Y.Doc();
    ws.deliver(
      encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        "shared.md",
        Y.encodeStateAsUpdate(seed),
      ),
    );

    ws.sent.length = 0;

    // A locally-originated transaction (origin tagged as 'local' so it
    // doesn't match the network-origin filter `origin === null`).
    // Inserting a real XML element produces a non-empty Yjs update.
    const sub = handler.getSubdoc("shared.md")!;
    sub.transact(() => {
      const fragment = sub.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
      const para = new Y.XmlElement("paragraph");
      para.insert(0, [new Y.XmlText("hi")]);
      fragment.insert(0, [para]);
    }, "local");

    const echoed = ws.framesOfType(MESSAGE_TYPE_SUBDOC_SYNC);
    assert.ok(echoed.length > 0, "local edit should send a SUBDOC_SYNC frame");
    const { filename } = decodeFileMessage(echoed[0].subarray(1));
    assert.equal(filename, "shared.md");
  });

  it("does not echo updates that arrived from the network", () => {
    const { ws, handler } = makeHandler();
    ws.fire("open", {});

    const filesMap = handler.rootDoc.getMap<Y.Doc>("files");
    filesMap.set("echo.md", new Y.Doc());
    const seed = new Y.Doc();
    ws.deliver(
      encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        "echo.md",
        Y.encodeStateAsUpdate(seed),
      ),
    );

    ws.sent.length = 0;

    // A second inbound update from the network (origin=null inside applyUpdate)
    // must NOT trigger another outbound SUBDOC_SYNC.
    const otherClient = new Y.Doc();
    otherClient.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME).insert(0, []);
    ws.deliver(
      encodeFileMessage(
        MESSAGE_TYPE_SUBDOC_SYNC,
        "echo.md",
        Y.encodeStateAsUpdate(otherClient),
      ),
    );

    assert.equal(
      ws.framesOfType(MESSAGE_TYPE_SUBDOC_SYNC).length,
      0,
      "network-origin updates must not echo back",
    );
  });

  it("close() transitions readyState and silences subsequent sends", () => {
    const { ws, handler } = makeHandler();
    ws.fire("open", {});
    ws.sent.length = 0;

    handler.close();
    handler.openFile("after-close.md");

    assert.equal(ws.readyState, 3);
    assert.equal(ws.sent.length, 0);
  });

  it("setUser updates awareness with the user payload", () => {
    const { ws, handler } = makeHandler();
    ws.fire("open", {});

    handler.setUser({ name: "jack", color: "#ff0000" });

    const state = handler.awareness.getLocalState() as {
      user?: unknown;
    } | null;
    assert.deepEqual(state?.user, { name: "jack", color: "#ff0000" });
  });

  it("setCurrentFile updates awareness with the current file", () => {
    const { ws, handler } = makeHandler();
    ws.fire("open", {});

    handler.setCurrentFile("notes.md");

    const state = handler.awareness.getLocalState() as {
      currentFile?: string | null;
    } | null;
    assert.equal(state?.currentFile, "notes.md");
  });
});
