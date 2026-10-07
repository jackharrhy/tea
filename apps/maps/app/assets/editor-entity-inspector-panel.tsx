import { clientEntry, css, on, type Handle } from "remix/component";
import type { EditorEntityInspectorContext } from "./editor-entity-inspector-bridge.ts";

export const EditorEntityInspector = clientEntry(
  `${import.meta.url}#EditorEntityInspector`,
  function EditorEntityInspectorComponent(handle: Handle) {
    let context: EditorEntityInspectorContext | null = null;
    const propertyDrafts = new Map<string, string>();

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-entity-inspector-bridge-ready",
        () =>
          window.dispatchEvent(new Event("tea-maps-entity-inspector-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-entity-inspector-state",
        (event) => {
          propertyDrafts.clear();
          context = (event as CustomEvent<EditorEntityInspectorContext>).detail;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-entity-inspector-ready"));
    });

    return () => {
      const state = context?.state;
      const editable = !!state && !state.propertyDisabled;
      return (
        <div mix={css({ display: "contents" })}>
          <div id="point-entity-inspector" hidden={!state?.pointVisible}>
            <h2>Selected point entity</h2>
            <label for="selected-point-classname">Classname</label>
            <input
              id="selected-point-classname"
              type="text"
              value={state?.pointClassname ?? ""}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setPointClassname(event.currentTarget.value);
              })}
            />
            <label for="selected-point-origin">Origin (X Y Z)</label>
            <input
              id="selected-point-origin"
              type="text"
              value={state?.pointOrigin ?? ""}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setPointOrigin(event.currentTarget.value);
              })}
            />
            <button
              id="update-point-entity"
              type="button"
              disabled={!state || state.pointDisabled}
              mix={on("click", () => context?.updatePoint())}
            >
              Update entity
            </button>
          </div>
          <div id="entity-properties" hidden={!state?.propertiesVisible}>
            <h2>Entity properties</h2>
            <div id="entity-property-list" aria-label="Existing properties">
              {state?.propertyRows.map((row) => (
                <div class="entity-property-row">
                  <label title={row.title}>
                    {row.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={
                          row.value !== "0" &&
                          row.value.toLowerCase() !== "false" &&
                          row.value !== ""
                        }
                        disabled={!editable}
                        mix={on<HTMLInputElement>("change", (event) => {
                          context?.commitProperty(
                            row.key,
                            event.currentTarget.checked ? "1" : "0",
                          );
                        })}
                      />
                    ) : null}
                    {row.label}
                    {row.type === "choices" && row.choices.length ? (
                      <select
                        value={row.value}
                        disabled={!editable}
                        mix={on<HTMLSelectElement>("change", (event) => {
                          context?.commitProperty(
                            row.key,
                            event.currentTarget.value,
                          );
                        })}
                      >
                        {row.choices.map((choice) => (
                          <option value={choice.value}>{choice.label}</option>
                        ))}
                      </select>
                    ) : row.type === "integer" ||
                      row.type === "float" ||
                      row.type === "angle" ? (
                      <input
                        type="number"
                        step={row.type === "integer" ? "1" : "any"}
                        value={propertyDrafts.get(row.key) ?? row.value}
                        placeholder={row.defaultValue}
                        disabled={!editable}
                        mix={[
                          on<HTMLInputElement>("input", (event) => {
                            propertyDrafts.set(
                              row.key,
                              event.currentTarget.value,
                            );
                            handle.update();
                          }),
                          on<HTMLInputElement>("change", (event) => {
                            propertyDrafts.delete(row.key);
                            context?.commitProperty(
                              row.key,
                              event.currentTarget.value,
                            );
                          }),
                        ]}
                      />
                    ) : row.type === "boolean" ||
                      (row.type === "flags" &&
                        row.choices.length > 0) ? null : (
                      <input
                        type="text"
                        value={propertyDrafts.get(row.key) ?? row.value}
                        placeholder={row.defaultValue}
                        disabled={!editable}
                        mix={[
                          on<HTMLInputElement>("input", (event) => {
                            propertyDrafts.set(
                              row.key,
                              event.currentTarget.value,
                            );
                            handle.update();
                          }),
                          on<HTMLInputElement>("change", (event) => {
                            propertyDrafts.delete(row.key);
                            context?.commitProperty(
                              row.key,
                              event.currentTarget.value,
                            );
                          }),
                        ]}
                      />
                    )}
                  </label>
                  {row.type === "flags" && row.choices.length ? (
                    <span class="entity-property-flags">
                      {row.choices.flatMap((choice) => {
                        const bit = Number(choice.value);
                        if (!Number.isInteger(bit) || bit <= 0) return [];
                        return [
                          <label>
                            <input
                              type="checkbox"
                              checked={((Number(row.value) || 0) & bit) === bit}
                              disabled={!editable}
                              mix={on<HTMLInputElement>("change", (event) => {
                                const current = Number(row.value) || 0;
                                context?.commitProperty(
                                  row.key,
                                  String(
                                    event.currentTarget.checked
                                      ? current | bit
                                      : current & ~bit,
                                  ),
                                );
                              })}
                            />
                            {choice.label}
                          </label>,
                        ];
                      })}
                    </span>
                  ) : null}
                  {state.propertyProtectionAvailable ? (
                    <label class="entity-property-protection">
                      <input
                        type="checkbox"
                        checked={row.protected}
                        disabled={!editable}
                        aria-label={`Keep ${row.key} independent in this linked copy`}
                        mix={on<HTMLInputElement>("change", (event) => {
                          context?.protectProperty(
                            row.key,
                            event.currentTarget.checked,
                          );
                        })}
                      />
                      Independent
                    </label>
                  ) : null}
                  {row.removable ? (
                    <button
                      type="button"
                      disabled={!editable}
                      aria-label={`Remove ${row.key}`}
                      mix={on("click", () =>
                        context?.commitProperty(row.key, null),
                      )}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <label for="entity-property-key">Key</label>
            <input
              id="entity-property-key"
              type="text"
              autoComplete="off"
              value={state?.propertyKey ?? ""}
              disabled={!editable}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setPropertyKey(event.currentTarget.value);
              })}
            />
            <label for="entity-property-value">Value</label>
            <input
              id="entity-property-value"
              type="text"
              value={state?.propertyValue ?? ""}
              disabled={!editable}
              mix={on<HTMLInputElement>("input", (event) => {
                context?.setPropertyValue(event.currentTarget.value);
              })}
            />
            <label
              id="entity-property-protection-option"
              for="entity-property-protected"
              hidden={!state?.propertyProtectionAvailable}
            >
              <input
                id="entity-property-protected"
                type="checkbox"
                checked={state?.propertyProtected ?? false}
                disabled={!editable || !state?.propertyProtectionAvailable}
                mix={on<HTMLInputElement>("change", (event) => {
                  context?.setPropertyProtected(event.currentTarget.checked);
                })}
              />
              Keep new property independent in this linked copy
            </label>
            <div class="entity-property-actions">
              <button
                id="save-entity-property"
                type="button"
                disabled={!state || state.saveDisabled}
                mix={on("click", () => context?.saveProperty())}
              >
                Save property
              </button>
              <button
                id="remove-entity-property"
                type="button"
                disabled={!state || state.removeDisabled}
                mix={on("click", () => context?.removeProperty())}
              >
                Remove property
              </button>
            </div>
          </div>
        </div>
      );
    };
  },
);
