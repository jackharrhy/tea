import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Awareness } from "y-protocols/awareness";
import {
  yCursorPlugin,
  ySyncPlugin,
  yUndoPlugin,
  yXmlFragmentToProseMirrorRootNode,
} from "y-prosemirror";
import * as Y from "yjs";

import { PROSEMIRROR_FRAGMENT_NAME } from "../shared/constants.ts";
import { plainTextSchema } from "../shared/doc-utils.ts";

export interface CollaborativeEditorOptions {
  subdoc: Y.Doc;
  awareness: Awareness;
}

// Wraps a ProseMirror EditorView bound to a Yjs subdoc fragment + awareness.
// `mount` is idempotent and `switchToSubdoc` lets the same editor instance
// move between files without remounting on a different host element.
export class CollaborativeEditor {
  private subdoc: Y.Doc;
  private fragment: Y.XmlFragment;
  private awareness: Awareness;
  private editorState: EditorState;
  private view: EditorView | null = null;

  constructor(options: CollaborativeEditorOptions) {
    this.subdoc = options.subdoc;
    this.awareness = options.awareness;
    this.fragment = this.subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
    this.editorState = createEditorState(this.fragment, this.awareness);
  }

  switchToSubdoc(subdoc: Y.Doc, awareness: Awareness): void {
    this.destroyView();
    this.subdoc = subdoc;
    this.awareness = awareness;
    this.fragment = this.subdoc.getXmlFragment(PROSEMIRROR_FRAGMENT_NAME);
    this.editorState = createEditorState(this.fragment, this.awareness);
  }

  mount(element: HTMLElement): void {
    this.destroyView();
    element.replaceChildren();
    this.view = new EditorView(element, {
      state: this.editorState,
      dispatchTransaction: (transaction) => {
        if (!this.view) return;
        const next = this.view.state.apply(transaction);
        this.view.updateState(next);
      },
    });
  }

  destroy(): void {
    this.destroyView();
  }

  private destroyView(): void {
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
  }
}

function createEditorState(
  fragment: Y.XmlFragment,
  awareness: Awareness,
): EditorState {
  return EditorState.create({
    schema: plainTextSchema,
    doc: yXmlFragmentToProseMirrorRootNode(fragment, plainTextSchema),
    plugins: [
      ySyncPlugin(fragment),
      yUndoPlugin(),
      yCursorPlugin(awareness),
      keymap(baseKeymap),
    ],
  });
}
