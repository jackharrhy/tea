import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { css } from "remix/component";

import {
  initializeScanSettings,
  resetScanSettings,
  updateScanSettings,
} from "#lib/settings.server";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import {
  Button,
  FormField,
  Inline,
  Panel,
  TextArea,
} from "../../../ui/primitives.tsx";
import { theme } from "../../../ui/styles.ts";

const introStyle = css({ color: theme.color.muted, margin: "0 0 1.5rem" });
const actionsStyle = css({
  display: "flex",
  gap: "0.75rem",
  marginBottom: "2rem",
});
const fieldStyle = css({ marginBottom: "1.5rem" });

export default createController(routes.admin.scanSettings, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const settings = await initializeScanSettings();
      return context.render(
        <AdminPage
          user={context.user}
          active="scan-settings"
          title="Scan settings"
        >
          <p mix={introStyle}>
            Choose which files and directories the archive scanner includes or
            skips.
          </p>
          <form method="post" action={routes.admin.scanSettings.action.href()}>
            <SettingsField
              name="excludeDirs"
              label="Excluded directories"
              help="Skip these directories wherever they appear in a path. Enter one per line."
              value={settings.excludeDirs.join("\n")}
            />
            <SettingsField
              name="excludeFilenames"
              label="Excluded filenames"
              help="Always skip these exact filenames, regardless of case."
              value={settings.excludeFilenames.join("\n")}
            />
            <SettingsField
              name="excludePathPatterns"
              label="Excluded path patterns"
              help="Regular expressions matched case-insensitively against paths."
              value={settings.excludePathPatterns.join("\n")}
            />
            <SettingsField
              name="knownGameDirs"
              label="Known game directories"
              help="Directory names that identify game content."
              value={settings.knownGameDirs.join("\n")}
            />
            <div mix={actionsStyle}>
              <Inline>
                <Button
                  type="submit"
                  name="intent"
                  value="save"
                  variant="primary"
                >
                  Save settings
                </Button>
                <Button type="submit" name="intent" value="reset">
                  Reset to defaults
                </Button>
              </Inline>
            </div>
          </form>
        </AdminPage>,
      );
    },
    async action(context) {
      const form = await context.request.formData();
      const intent = form.get("intent");
      if (intent === "reset") await resetScanSettings();
      else if (intent === "save") {
        const result = await updateScanSettings({
          excludeDirs: lines(form.get("excludeDirs")),
          excludeFilenames: lines(form.get("excludeFilenames")),
          excludePathPatterns: lines(form.get("excludePathPatterns")),
          knownGameDirs: lines(form.get("knownGameDirs")),
        });
        if (result.isErr())
          return new Response(result.error.message, { status: 400 });
      } else return new Response("Unknown settings action", { status: 400 });
      return redirect(routes.admin.scanSettings.index.href(), 303);
    },
  },
});

function SettingsField(handle: {
  props: { name: string; label: string; help: string; value: string };
}) {
  return () => (
    <div mix={fieldStyle}>
      <Panel>
        <FormField
          label={handle.props.label}
          htmlFor={handle.props.name}
          hint={handle.props.help}
        >
          <TextArea
            id={handle.props.name}
            name={handle.props.name}
            value={handle.props.value}
            rows={7}
            fullWidth
            mono
          />
        </FormField>
      </Panel>
    </div>
  );
}

function lines(value: FormDataEntryValue | null): string[] {
  return typeof value === "string"
    ? value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
}
