# artbin UI system

The shared UI layer is the source of truth for recurring interface patterns. The live reference is available at `/dev/kitchen-sink`.

## Foundations

- `styles.ts` owns document-level tokens and low-level Remix `css()` descriptors used by interactive client entries.
- `primitives.tsx` owns actions, feedback, fields, layout headers, status, progress, tables, metadata, and disclosure components.
- `navigation.tsx` owns tabs and breadcrumbs.
- `media-card.tsx` owns folder and asset cards.
- `modal.tsx` owns the dialog frame used by upload flows.

## Composition rules

1. Use a shared component when the interface has the same meaning as an existing kitchen sink example.
2. Keep route-local `css()` descriptors for domain-specific layout only.
3. Add a new shared component when the same visual or interaction pattern appears in a second route.
4. Add every new shared visual state to the kitchen sink in the same change.
5. Keep behavior in the component that owns it. Do not pass browser event handlers through server-rendered route data.

The kitchen sink deliberately renders production components such as `FileCollection`, `SearchBar`, `ModelViewer`, `UploadControl`, and `LuckyButton`. This keeps the reference page honest and makes visual drift visible during development.
