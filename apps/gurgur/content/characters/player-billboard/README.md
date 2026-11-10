# Player billboard harness

[`player-billboard-harness.blend`](player-billboard-harness.blend) contains a
120-view orthographic camera rig sized around Gurgur's standing player collider:

- height: 1.8 m
- radius: 0.35 m
- image size: 64 x 64 RGBA
- elevation range: -75 through +75 degrees
- sampling: nine latitude rings with 8-16 azimuth views per ring
- shading: five hard ambient bands based only on vertical surface orientation
- lighting: emission-based and azimuth-neutral, with no directional scene lights
- rasterization: one Eevee sample, temporal reprojection disabled, and a minimal
  pixel filter for deliberately jagged low-resolution edges

The Blender scene is named `Player Billboard Harness`. Replace or hide the
objects in `PLAYER`, keeping the character inside
`PlayerColliderGuide`. Character forward is Blender `-Y`. The setup command
rebuilds the banded shader for every material used by that collection from its
material viewport color.

Run the reproducible headless renderer from the repository root:

```sh
bun run render:player
```

The Python camera layout is authoritative. Rebuild the saved Blender rig after
changing it with:

```sh
bun run setup:player-harness
```

The render command rebuilds the same rig in memory, validates its timeline
markers, and writes individual views, an 11 x 11 RGBA atlas, and JSON metadata
under `content/generated/player-billboard/`. Set `BLENDER_BIN` if the Blender
executable is not on `PATH` or installed in the standard macOS location.
Pass `--reuse-frames` while iterating on atlas metadata without rebaking unchanged
camera images.

For interactive previews, **Render > Render Animation** renders frames `0000`
through `0119`. At runtime the closest authored 3D view vector is selected after
rotating the live camera vector into player-local space.

The original default Blender scene remains in the file and was not modified.
