import { assets } from "../packages/teacms/app/assets.ts";
const entries = [
  "packages/teacms/app/actions/public/entry.ts",
  "packages/teacms/app/actions/admin/public/editor.tsx",
  "packages/teacms/app/actions/admin/public/media-library.tsx",
  "packages/teacms/app/actions/admin/public/navigation-editor.tsx",
  "packages/teacms/app/actions/admin/public/navigation-toggle.tsx",
  "packages/teacms/app/actions/admin/public/site-settings.tsx",
  "packages/teacms/app/features/adornments/public/adornment-library.tsx",
  "sites/luke/app/public/navigation-editor.tsx",
];
try {
  const hrefs = new Set<string>();
  for (const entry of entries) {
    const script = await assets.getScriptEntry(entry);
    hrefs.add(script.href);
    for (const href of script.preloads) hrefs.add(href);
  }
  for (const href of hrefs) {
    const response = await assets.fetch(
      new Request(new URL(href, "http://localhost")),
    );
    if (!response?.ok) throw new Error(`Browser asset failed: ${href}`);
    await response.arrayBuffer();
  }
  console.log(
    `Verified ${hrefs.size} browser modules. Remix serves TypeScript directly; no server bundle is required.`,
  );
} finally {
  await assets.close();
}
