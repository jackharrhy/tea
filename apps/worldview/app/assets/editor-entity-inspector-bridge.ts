import type { EntityPropertyRow } from "./editor-entity-properties.ts";

export interface EditorEntityInspectorState {
  readonly pointVisible: boolean;
  readonly pointClassname: string;
  readonly pointOrigin: string;
  readonly pointDisabled: boolean;
  readonly propertiesVisible: boolean;
  readonly propertyRows: readonly EntityPropertyRow[];
  readonly propertyKey: string;
  readonly propertyValue: string;
  readonly propertyProtected: boolean;
  readonly propertyProtectionAvailable: boolean;
  readonly propertyDisabled: boolean;
  readonly saveDisabled: boolean;
  readonly removeDisabled: boolean;
}

export interface EditorEntityInspectorContext {
  readonly state: EditorEntityInspectorState;
  readonly setPointClassname: (value: string) => void;
  readonly setPointOrigin: (value: string) => void;
  readonly setPropertyKey: (value: string) => void;
  readonly setPropertyValue: (value: string) => void;
  readonly setPropertyProtected: (value: boolean) => void;
  readonly updatePoint: () => void;
  readonly saveProperty: () => void;
  readonly removeProperty: () => void;
  readonly commitProperty: (key: string, value: string | null) => void;
  readonly protectProperty: (key: string, protect: boolean) => void;
}

export function initEditorEntityInspector(actions: {
  readonly refreshPropertyActions: () => void;
  readonly updatePoint: () => void;
  readonly saveProperty: () => void;
  readonly removeProperty: () => void;
  readonly commitProperty: (key: string, value: string | null) => void;
  readonly protectProperty: (key: string, protect: boolean) => void;
}) {
  let state: EditorEntityInspectorState = {
    pointVisible: false,
    pointClassname: "",
    pointOrigin: "",
    pointDisabled: true,
    propertiesVisible: false,
    propertyRows: [],
    propertyKey: "",
    propertyValue: "",
    propertyProtected: false,
    propertyProtectionAvailable: false,
    propertyDisabled: true,
    saveDisabled: true,
    removeDisabled: true,
  };
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorEntityInspectorContext>(
        "tea-maps-entity-inspector-state",
        {
          detail: {
            state,
            setPointClassname,
            setPointOrigin,
            setPropertyKey,
            setPropertyValue,
            setPropertyProtected,
            updatePoint: actions.updatePoint,
            saveProperty: actions.saveProperty,
            removeProperty: actions.removeProperty,
            commitProperty: actions.commitProperty,
            protectProperty: actions.protectProperty,
          },
        },
      ),
    );
  }

  function update(patch: Partial<EditorEntityInspectorState>) {
    state = { ...state, ...patch };
    publish();
  }

  function setPointClassname(pointClassname: string) {
    update({ pointClassname });
  }

  function setPointOrigin(pointOrigin: string) {
    update({ pointOrigin });
  }

  function setPropertyKey(propertyKey: string) {
    update({ propertyKey });
    actions.refreshPropertyActions();
  }

  function setPropertyValue(propertyValue: string) {
    update({ propertyValue });
  }

  function setPropertyProtected(propertyProtected: boolean) {
    update({ propertyProtected });
  }

  window.addEventListener("tea-maps-entity-inspector-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-entity-inspector-bridge-ready"));

  return {
    get state() {
      return state;
    },
    update,
  };
}
