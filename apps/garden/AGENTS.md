# Garden contributor guidance

Read this workspace README and the root Remix skill. Use native Remix 3, not React or Astro. Preserve the original site's appearance and Markdown behavior; compare browser screenshots before declaring parity. Keep all application behavior here until another consumer needs it.

The vault is external and contains private writing. Only explicit boolean `public: true` notes may enter routes, feeds, link indexes, manifests, or production snapshots. Never expose a vault directory through the browser asset server. Do not write, rephrase, polish, summarize, or otherwise change Jack's prose without approval of the specific wording. Raindrop draft-writing commands require explicit user intent.

Tests use generated fixtures in `__tests__/`, not the personal vault. Run `npm run check --workspace @harrhy/garden`. Keep snapshots, comparison images, local state, and credentials ignored. Infrastructure changes live in the infrastructure repo; retire the standalone code only after a verified cutover, keeping its GitHub repository as a README pointer.
