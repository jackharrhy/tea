from __future__ import annotations

import argparse
import json
import math
import re
import sys
from array import array
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import MARKER_PREFIX, SCENE_NAME, rebuild_camera_rig


def arguments() -> argparse.Namespace:
    blender_arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--columns", type=int, default=0)
    parser.add_argument("--save-harness", action="store_true")
    parser.add_argument("--setup-only", action="store_true")
    parser.add_argument("--reuse-frames", action="store_true")
    return parser.parse_args(blender_arguments)


def directional_markers(scene: bpy.types.Scene) -> list[bpy.types.TimelineMarker]:
    markers = sorted(
        (marker for marker in scene.timeline_markers if marker.name.startswith(MARKER_PREFIX)),
        key=lambda marker: marker.frame,
    )
    expected_count = int(scene.get("direction_count", 0))
    if expected_count < 1:
        raise RuntimeError("scene direction_count must be a positive integer")
    if len(markers) != expected_count:
        raise RuntimeError(f"expected {expected_count} directional markers, found {len(markers)}")
    if [marker.frame for marker in markers] != list(range(expected_count)):
        raise RuntimeError("directional markers must occupy consecutive frames starting at zero")
    if any(marker.camera is None for marker in markers):
        raise RuntimeError("every directional marker must bind a camera")
    cameras = [marker.camera for marker in markers]
    if len(set(cameras)) != len(cameras):
        raise RuntimeError("directional markers must bind distinct cameras")
    for index, camera in enumerate(cameras):
        if int(camera.get("view_index", -1)) != index:
            raise RuntimeError(f"{camera.name} has an invalid view_index")
    return markers


def safe_name(marker: bpy.types.TimelineMarker, index: int) -> str:
    suffix = marker.name.removeprefix(MARKER_PREFIX).lower()
    suffix = re.sub(r"^\d+[_-]*", "", suffix)
    suffix = re.sub(r"[^a-z0-9]+", "-", suffix).strip("-")
    return f"view-{index:03d}-{suffix}.png"


def render_frame(
    scene: bpy.types.Scene,
    marker: bpy.types.TimelineMarker,
    output_path: Path,
) -> None:
    scene.frame_set(marker.frame)
    scene.camera = marker.camera
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)
    if not output_path.is_file():
        raise RuntimeError(f"Blender did not write {output_path}")


def build_atlas(
    frame_paths: list[Path],
    output_path: Path,
    columns: int,
    frame_width: int,
    frame_height: int,
) -> tuple[int, int]:
    rows = math.ceil(len(frame_paths) / columns)
    atlas_width = columns * frame_width
    atlas_height = rows * frame_height
    pixels = array("f", [0.0]) * (atlas_width * atlas_height * 4)

    for index, frame_path in enumerate(frame_paths):
        frame = bpy.data.images.load(str(frame_path), check_existing=False)
        try:
            if tuple(frame.size) != (frame_width, frame_height):
                raise RuntimeError(
                    f"{frame_path.name} is {frame.size[0]}x{frame.size[1]}, "
                    f"expected {frame_width}x{frame_height}"
                )
            source = array("f", frame.pixels[:])
            column = index % columns
            top_row = index // columns
            destination_row = rows - top_row - 1
            for source_y in range(frame_height):
                source_start = source_y * frame_width * 4
                destination_start = (
                    ((destination_row * frame_height + source_y) * atlas_width)
                    + column * frame_width
                ) * 4
                pixels[destination_start : destination_start + frame_width * 4] = source[
                    source_start : source_start + frame_width * 4
                ]
        finally:
            bpy.data.images.remove(frame)

    atlas = bpy.data.images.new(
        "Generated Player Billboard Atlas",
        width=atlas_width,
        height=atlas_height,
        alpha=True,
        float_buffer=False,
    )
    try:
        atlas.pixels.foreach_set(pixels)
        atlas.file_format = "PNG"
        atlas.filepath_raw = str(output_path)
        atlas.save()
    finally:
        bpy.data.images.remove(atlas)
    return atlas_width, atlas_height


def main() -> None:
    options = arguments()
    scene = bpy.data.scenes.get(SCENE_NAME)
    if scene is None:
        raise RuntimeError(f"blend file does not contain the {SCENE_NAME!r} scene")

    bpy.context.window.scene = scene
    rebuild_camera_rig(scene)
    if options.save_harness:
        bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, check_existing=False)
    if options.setup_only:
        print(f"Saved {scene['direction_count']} code-defined camera views to {bpy.data.filepath}")
        return
    if options.output is None:
        raise RuntimeError("--output is required unless --setup-only is used")
    markers = directional_markers(scene)
    columns = options.columns or math.ceil(math.sqrt(len(markers)))
    if columns < 1:
        raise RuntimeError("--columns must be positive")
    frame_width = scene.render.resolution_x * scene.render.resolution_percentage // 100
    frame_height = scene.render.resolution_y * scene.render.resolution_percentage // 100
    if frame_width < 1 or frame_height < 1:
        raise RuntimeError("render dimensions must be positive")

    output = options.output.resolve()
    frames_directory = output / "frames"
    frames_directory.mkdir(parents=True, exist_ok=True)
    if not options.reuse_frames:
        for stale_frame in frames_directory.glob("*.png"):
            stale_frame.unlink()
    frame_paths: list[Path] = []
    directions: list[dict[str, object]] = []

    for index, marker in enumerate(markers):
        frame_path = frames_directory / safe_name(marker, index)
        if options.reuse_frames:
            if not frame_path.is_file():
                raise RuntimeError(f"cannot reuse missing frame {frame_path}")
        else:
            render_frame(scene, marker, frame_path)
        frame_paths.append(frame_path)
        camera_offset = marker.camera.matrix_world.translation - bpy.data.objects[
            "BillboardTarget"
        ].matrix_world.translation
        camera_offset.normalize()
        azimuth_degrees = float(marker.camera["view_azimuth_degrees_clockwise"])
        elevation_degrees = float(marker.camera["view_elevation_degrees"])
        directions.append(
            {
                "index": index,
                "azimuthDegreesClockwise": azimuth_degrees,
                "elevationDegrees": elevation_degrees,
                "viewDirection": {
                    "x": round(camera_offset.x, 8),
                    "y": round(camera_offset.z, 8),
                    "z": round(camera_offset.y, 8),
                },
                "camera": marker.camera.name,
                "frame": marker.frame,
                "file": frame_path.relative_to(output).as_posix(),
                "column": index % columns,
                "row": index // columns,
            }
        )

    atlas_path = output / "player-billboard.png"
    atlas_width, atlas_height = build_atlas(
        frame_paths,
        atlas_path,
        columns,
        frame_width,
        frame_height,
    )
    metadata = {
        "version": 1,
        "image": atlas_path.name,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "atlasWidth": atlas_width,
        "atlasHeight": atlas_height,
        "columns": columns,
        "rows": math.ceil(len(markers) / columns),
        "sampling": scene.get("view_sampling"),
        "quad": {
            "widthMeters": round(
                float(scene.camera.data.ortho_scale) * frame_width / frame_height, 6
            ),
            "heightMeters": round(float(scene.camera.data.ortho_scale), 6),
            "center": {"x": 0.5, "y": 0.5},
        },
        "playerCollider": {
            "heightMeters": float(scene.get("player_collider_height_m", 0.0)),
            "radiusMeters": float(scene.get("player_collider_radius_m", 0.0)),
        },
        "views": directions,
    }
    metadata_path = output / "player-billboard.json"
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(
        f"Rendered {len(markers)} directions at {frame_width}x{frame_height}; "
        f"wrote {atlas_width}x{atlas_height} atlas to {atlas_path}"
    )


if __name__ == "__main__":
    main()
