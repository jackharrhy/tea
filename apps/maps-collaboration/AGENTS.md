# Maps collaboration workspace

Read this README and the Tea root guidance before editing. Keep map state and operations in `MapCell`; Remix routes in `src/routes.ts` and `src/index.ts` own the HTTP boundary. Preserve the WebSocket protocol and map cell identity for later hosted-service integration. `wrangler.jsonc` must remain compatible with both Wrangler and Celld. Run this workspace's check and relevant editor and protocol checks after changing their contracts. Keep Worker tests in `__tests__/`.
