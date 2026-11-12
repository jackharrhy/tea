# @harrhy/gurgur-engine

Gurgur's shared Box3D physics wrapper, 60 Hz fixed-step clock, protocol v7 codecs, network state and world format. It is used by the Bun authority and browser prediction worker. The engine has no DOM, Three.js, sockets or SQLite dependency.

The wrapper converts Gurgur's object-shaped positions and rotations to Box3D 0.1's tuple math at the physics boundary. The public `Vec3` and `Quat` values, network packets, and saved world format stay object-shaped.

Install at the Tea root with `npm ci`; Bun 1.4.4 is required for tests. Run `npm run check --workspace @harrhy/gurgur-engine` for types and focused tests. The source entry is `src/index.ts`. Physics remains at four Box3D substeps per 60 Hz tick; clients may predict but never own authoritative shared transforms.
