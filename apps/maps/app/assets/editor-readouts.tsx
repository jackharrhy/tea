import { clientEntry, type Handle } from "remix/component";

export const EditorDocumentName = clientEntry(
  `${import.meta.url}#EditorDocumentName`,
  function EditorDocumentNameComponent(handle: Handle) {
    let name = "tea-map.map";

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-editor-document-name",
        (event) => {
          name = (event as CustomEvent<string>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      name = document.documentElement.dataset.editorDocumentName ?? name;
      handle.update();
    });

    return () => (
      <strong id="document-name" title={name}>
        {name}
      </strong>
    );
  },
);

export const EditorStatus = clientEntry(
  `${import.meta.url}#EditorStatus`,
  function EditorStatusComponent(handle: Handle) {
    let message = "Starting…";

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-editor-status",
        (event) => {
          message = (event as CustomEvent<string>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      message = document.documentElement.dataset.editorStatus ?? message;
      handle.update();
    });

    return () => (
      <span id="editor-status" role="status">
        {message}
      </span>
    );
  },
);

export const EditorSelectionInfo = clientEntry(
  `${import.meta.url}#EditorSelectionInfo`,
  function EditorSelectionInfoComponent(handle: Handle) {
    let message = "No selection";

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-editor-selection",
        (event) => {
          message = (event as CustomEvent<string>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      message = document.documentElement.dataset.editorSelection ?? message;
      handle.update();
    });

    return () => <p id="selection-info">{message}</p>;
  },
);
