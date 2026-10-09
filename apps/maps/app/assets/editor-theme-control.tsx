import { clientEntry, on, type Handle } from "remix/component";
import { editorThemeEvent, type EditorTheme } from "./editor-theme.ts";

type ThemePreference = EditorTheme | "system";
const storageKey = "tea.maps.editor.theme";

function storedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "dark" || value === "light" || value === "system" ? value : "dark";
  } catch {
    return "dark";
  }
}

export const EditorThemeControl = clientEntry(
  `file:///app/assets/editor-theme-control.tsx#EditorThemeControl`,
  function EditorThemeControlComponent(handle: Handle) {
    let preference: ThemePreference = "dark";

    function applyTheme(systemLight: boolean) {
      const theme: EditorTheme =
        preference === "system" ? (systemLight ? "light" : "dark") : preference;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "light" ? "#f5f5f5" : "#252527");
      window.dispatchEvent(new CustomEvent(editorThemeEvent, { detail: theme }));
    }

    handle.queueTask(() => {
      preference = storedPreference();
      const systemTheme = window.matchMedia("(prefers-color-scheme: light)");
      applyTheme(systemTheme.matches);
      systemTheme.addEventListener(
        "change",
        () => {
          if (preference === "system") applyTheme(systemTheme.matches);
        },
        { signal: handle.signal },
      );
      handle.update();
    });

    return () => (
      <label class="editor-theme-choice" for="editor-theme">
        Theme
        <select
          id="editor-theme"
          value={preference}
          mix={on<HTMLSelectElement>("change", (event) => {
            preference = event.currentTarget.value as ThemePreference;
            try {
              localStorage.setItem(storageKey, preference);
            } catch {
              // Keep the choice for this page when storage is unavailable.
            }
            applyTheme(window.matchMedia("(prefers-color-scheme: light)").matches);
            handle.update();
          })}
        >
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
    );
  },
);
