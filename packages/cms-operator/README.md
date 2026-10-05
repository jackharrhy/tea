# @tea/cms-operator

The Remix 3 dashboard for the [Node CMS host](../../apps/cms/README.md). This package has the router, UI, store, and public assets; the host supplies the operator origin and registered sites.

## Entry points

- `@tea/cms-operator/router.tsx` exports `createOperatorRouter`.
- `@tea/cms-operator/store.ts` owns operator data access.
- `public/` holds the dashboard's browser assets.

It can use `@tea/cms-core` contracts, but must not import the app or site presentations. The app owns hostname registration, startup, and deployment.

## Working here

From the root, run `npm ci` and `npm run cms:check` to check the dashboard, host, and tests. Put new tests in a nearby `__tests__/` directory.
