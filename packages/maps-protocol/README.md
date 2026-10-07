# @tea/maps-protocol

Shared schemas and messages for the Maps hosted-project service, collaboration Worker, and local compiler. `src/index.ts` exports the protocol; `src/hosted.ts`, `src/collaboration.ts`, and related files define its parts. This package depends on the public editor core and has no app imports. Its game-tree path rule admits contained Quake II texture and palette files for the local compiler while rejecting traversal and arbitrary extensions.

From the repo root, run `npm ci` and `npm run check --workspace @tea/maps-protocol`. The check typechecks, runs `__tests__/`, and builds the importable module. Run the editor and renderer checks when their public contracts change. The [MIT license](LICENSE) accompanies this copy of Worldview's protocol. The original Worldview protocol remains in use by the original deployment during Tea's bake period.
