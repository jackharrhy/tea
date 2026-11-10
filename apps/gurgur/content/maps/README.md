# Systems Garden

[`systems-garden.map`](systems-garden.map) is the first authored Gurgur world and
an intentionally spacious systems test map. It uses Valve 220 texture axes and
the canonical one-map-unit-equals-one-inch scale.

The rough layout is:

```text
 north
 ┌──────────────────────────────────────────────────────────┐
 │ sensors / relays              stairs    slope   steep    │
 │                                                          │
 │ physics gallery      button → sliding door               │
 │                                                          │
 │ spawn / reset                   lift platform + button    │
 └──────────────────────────────────────────────────────────┘
 south
```

The map explicitly declares Valve map version 220 and contains all base schema
classes, 31 convex brushes, six dynamic props,
a three-box stack, a button/relay/door chain, a lift, one-shot and repeatable
trigger volumes, eight 12-unit controller steps, a walkable ramp, and a steep
rejection ramp. Trigger material is intentionally visible in this first map so
sensor placement remains obvious while systems are brought online.

Load [`../trenchbroom/Gurgur.fgd`](../trenchbroom/Gurgur.fgd) in TrenchBroom to
see the custom entity definitions. Regenerate it after schema changes with
`bun run generate:fgd`.

Map fixtures must retain inward face winding. TrenchBroom rejects consistently
outward-wound planes as empty brushes even though the Gurgur compiler can
mathematically normalize them; the map test checks both requirements.
