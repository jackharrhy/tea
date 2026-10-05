---
name: remix
description: Builds, reviews, and refactors Remix 3 apps using the remix package and remix/* imports. Use for application structure, routing, middleware, data, auth, UI, browser interaction, and tests; not for implementing Remix framework packages.
---

# Remix app guide

## Read the installed docs

Before using an unfamiliar Remix API:

1. Read the app's `AGENTS.md`, `package.json`, and `tsconfig.json`. Inspect the code you will change.
2. Search `node_modules/remix/INDEX.md` by task, export, or keyword, for example `grep -i 'session' node_modules/remix/INDEX.md`.
3. Read the linked guide, then the package README for imports, options, behavior, and examples. If there is no guide, use the API README and existing app patterns.

The installed docs take precedence over this skill. Avoid remembered Remix 2 patterns and online APIs from other versions. If the installation has no index, check its `package.json` exports, READMEs, source, and types.

## How Remix fits together

Remix uses Web APIs such as `Request`, `Response`, `URL`, and `FormData`. Its parts compose at runtime. Do not assume file-based routing, generated route types, or a required build step.

### Routes, Router, and Controllers

Routing usually has three parts:

- **Routes** define URLs and methods, including typed URL generation (`app/routes.ts` in the starter).
- **Router** connects routes, middleware, and controllers (`app/router.ts`).
- **Controllers** handle matched routes (`app/actions/`).

This applies to server apps and browser apps using the SPA router. Each part is replaceable. Follow the app's choices; for a new app, use the documented starter conventions.

A server route can return a Web `Response`:

```ts
// app/routes.ts
import { get, route } from 'remix/routes'

export const routes = route({
  hello: get('/hello/:name'),
})
```

```ts
// app/actions/controller.ts
import { createController } from 'remix/router'

import { routes } from '../routes.ts'

export default createController(routes, {
  actions: {
    hello(context) {
      return new Response(`Hello, ${context.params.name}!`)
    },
  },
})
```

```ts
// app/router.ts
import { createRouter } from 'remix/router'

import controller from './actions/controller.ts'
import { routes } from './routes.ts'

export const router = createRouter()
router.map(routes, controller)
```

The runtime adapter calls `router.fetch(request)`. Use the same route contract for URLs: `routes.hello.href({ name: 'Remix' })` produces `/hello/Remix`.

### Components

Remix components use JSX, but are not React components. Setup runs once per instance and returns a render function. Setup variables keep state between renders. Event handlers can change that state and call `handle.update()` to render again:

```tsx
import { on } from 'remix/component'
import type { Handle } from 'remix/component'

function Counter(handle: Handle) {
  let count = 0

  return () => (
    <button
      type="button"
      mix={on('click', () => {
        count++
        handle.update()
      })}
    >
      Count: {count}
    </button>
  )
}
```

Read changing props from `handle.props` during render. Do not capture their initial values in setup or use React hooks and lifecycle assumptions.

Event handlers need a mounted or hydrated browser component. Server-rendered HTML alone is not interactive. Follow the installed interactivity guide and the app's browser entry setup.

## Work Within the App

- Keep the app's package manager, scripts, runtime, middleware order, and imports unless the task requires a change. Do not replace working code to match the starter.
- Change the code that owns the behavior. Keep route code together; share it when multiple areas need it.
- Prefer Web APIs, native links, buttons, forms, and existing Remix primitives over custom abstractions.
- Treat browser-reachable modules as public. Keep secrets and trusted server logic out. In the starter, colocated `public/` directories mark browser-reachable source.

## Verify the Behavior

Run relevant app tests and typechecks, then verify the behavior. For UI changes, use the browser. For enhanced server-rendered pages, check ordinary document behavior and the enhanced path. For untrusted input or access control, test rejection and failure paths.

Use the installed testing guide and CLI docs. Run `remix doctor` after structural or configuration changes and review its findings before fixing them. Do not run destructive database commands or rewrite config just to pass a diagnostic. Report checks and anything unverified.
