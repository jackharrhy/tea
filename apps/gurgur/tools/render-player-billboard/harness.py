from __future__ import annotations

import math
from dataclasses import dataclass

import bpy
from mathutils import Vector


SCENE_NAME = "Player Billboard Harness"
MARKER_PREFIX = "View_"
CAMERA_COLLECTION_PREFIX = "Cameras_"
CAMERA_DISTANCE_METERS = 4.0
ORTHOGRAPHIC_SCALE_METERS = 2.15
FRAME_SIZE_PIXELS = 64
PIXEL_FILTER_SIZE = 0.01

# Cover the camera's +/-77 degree pitch range with fewer redundant views near the poles.
VIEW_RINGS: tuple[tuple[float, int], ...] = (
    (-75.0, 8),
    (-56.25, 12),
    (-37.5, 16),
    (-18.75, 16),
    (0.0, 16),
    (18.75, 16),
    (37.5, 16),
    (56.25, 12),
    (75.0, 8),
)


@dataclass(frozen=True)
class AuthoredView:
    index: int
    elevation_degrees: float
    azimuth_degrees_clockwise: float


def authored_views() -> list[AuthoredView]:
    views: list[AuthoredView] = []
    for elevation, azimuth_count in VIEW_RINGS:
        for ring_index in range(azimuth_count):
            views.append(
                AuthoredView(
                    index=len(views),
                    elevation_degrees=elevation,
                    azimuth_degrees_clockwise=360.0 * ring_index / azimuth_count,
                )
            )
    return views


def _remove_camera_collection(parent: bpy.types.Collection) -> None:
    for child in list(parent.children):
        if not child.name.startswith(CAMERA_COLLECTION_PREFIX):
            continue
        for obj in list(child.all_objects):
            camera_data = obj.data if isinstance(obj.data, bpy.types.Camera) else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if camera_data is not None and camera_data.users == 0:
                bpy.data.cameras.remove(camera_data)
        bpy.data.collections.remove(child)


def _band_color(color: tuple[float, float, float, float], amount: float) -> tuple[float, ...]:
    return tuple(min(1.0, channel * amount) for channel in color[:3]) + (color[3],)


def _configure_banded_material(material: bpy.types.Material) -> None:
    base_color = tuple(material.diffuse_color)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (600, 0)
    geometry = nodes.new("ShaderNodeNewGeometry")
    geometry.location = (-600, 0)
    upward = nodes.new("ShaderNodeVectorMath")
    upward.operation = "DOT_PRODUCT"
    upward.inputs[1].default_value = (0.0, 0.0, 1.0)
    upward.location = (-400, 0)
    half = nodes.new("ShaderNodeMath")
    half.operation = "MULTIPLY"
    half.inputs[1].default_value = 0.5
    half.location = (-200, 0)
    bias = nodes.new("ShaderNodeMath")
    bias.operation = "ADD"
    bias.inputs[1].default_value = 0.5
    bias.location = (0, 0)
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (180, 0)
    ramp.color_ramp.interpolation = "CONSTANT"
    bands = (
        (0.0, 0.28),
        (0.28, 0.48),
        (0.48, 0.72),
        (0.68, 0.92),
        (0.84, 1.12),
    )
    while len(ramp.color_ramp.elements) > 1:
        ramp.color_ramp.elements.remove(ramp.color_ramp.elements[-1])
    first = ramp.color_ramp.elements[0]
    first.position = bands[0][0]
    first.color = _band_color(base_color, bands[0][1])
    for position, amount in bands[1:]:
        element = ramp.color_ramp.elements.new(position)
        element.color = _band_color(base_color, amount)
    emission = nodes.new("ShaderNodeEmission")
    emission.location = (400, 0)
    material.node_tree.links.new(geometry.outputs["Normal"], upward.inputs[0])
    material.node_tree.links.new(upward.outputs["Value"], half.inputs[0])
    material.node_tree.links.new(half.outputs[0], bias.inputs[0])
    material.node_tree.links.new(bias.outputs[0], ramp.inputs[0])
    material.node_tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])
    material.node_tree.links.new(emission.outputs[0], output.inputs["Surface"])
    material["gurgur_billboard_shading"] = "five-band vertical ambient"


def configure_render_look(scene: bpy.types.Scene) -> None:
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = FRAME_SIZE_PIXELS
    scene.render.resolution_y = FRAME_SIZE_PIXELS
    scene.render.resolution_percentage = 100
    scene.render.filter_size = PIXEL_FILTER_SIZE
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    if hasattr(scene.render, "dither_intensity"):
        scene.render.dither_intensity = 0.0
    scene.eevee.taa_samples = 1
    scene.eevee.taa_render_samples = 1
    scene.eevee.use_taa_reprojection = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    for obj in list(scene.objects):
        if obj.type == "LIGHT":
            light_data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if light_data.users == 0:
                bpy.data.lights.remove(light_data)

    world = scene.world
    if world is not None:
        world.use_nodes = True
        background = world.node_tree.nodes.get("Background")
        if background is not None:
            background.inputs["Color"].default_value = (0.035, 0.04, 0.05, 1.0)
            background.inputs["Strength"].default_value = 0.0

    art = bpy.data.collections.get("PLAYER")
    if art is None:
        raise RuntimeError("scene is missing PLAYER")
    materials = {
        material
        for obj in art.all_objects
        for slot in obj.material_slots
        if (material := slot.material) is not None
    }
    for material in materials:
        _configure_banded_material(material)
    scene["render_style"] = "64px unantialiased five-band ambient emission"


def rebuild_camera_rig(scene: bpy.types.Scene) -> list[bpy.types.TimelineMarker]:
    harness = bpy.data.collections.get("HARNESS")
    if harness is None or harness.name not in scene.collection.children:
        raise RuntimeError("scene is missing its HARNESS collection")
    target = bpy.data.objects.get("BillboardTarget")
    if target is None:
        raise RuntimeError("scene is missing BillboardTarget")

    configure_render_look(scene)
    _remove_camera_collection(harness)
    for marker in list(scene.timeline_markers):
        if marker.name.startswith(("Direction_", MARKER_PREFIX)):
            scene.timeline_markers.remove(marker)

    camera_collection = bpy.data.collections.new("Cameras_Spherical_120_Views")
    harness.children.link(camera_collection)
    rig_root = bpy.data.objects.new("CameraRig_Spherical_120_Views", None)
    rig_root.empty_display_type = "SPHERE"
    rig_root.empty_display_size = CAMERA_DISTANCE_METERS
    camera_collection.objects.link(rig_root)

    markers: list[bpy.types.TimelineMarker] = []
    cameras: list[bpy.types.Object] = []
    target_position = target.matrix_world.translation
    for view in authored_views():
        elevation = math.radians(view.elevation_degrees)
        azimuth = math.radians(view.azimuth_degrees_clockwise)
        horizontal = math.cos(elevation) * CAMERA_DISTANCE_METERS
        position = Vector(
            (
                math.sin(azimuth) * horizontal,
                -math.cos(azimuth) * horizontal,
                math.sin(elevation) * CAMERA_DISTANCE_METERS,
            )
        ) + target_position
        label = (
            f"{view.index:03d}_e{view.elevation_degrees:+06.2f}_"
            f"a{view.azimuth_degrees_clockwise:06.2f}"
        )
        camera_data = bpy.data.cameras.new(f"Camera_{label}.Data")
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = ORTHOGRAPHIC_SCALE_METERS
        camera = bpy.data.objects.new(f"Camera_{label}", camera_data)
        camera_collection.objects.link(camera)
        camera.parent = rig_root
        camera.location = position
        camera.rotation_euler = (target_position - position).to_track_quat("-Z", "Y").to_euler()
        camera["view_index"] = view.index
        camera["view_elevation_degrees"] = view.elevation_degrees
        camera["view_azimuth_degrees_clockwise"] = view.azimuth_degrees_clockwise
        marker = scene.timeline_markers.new(f"{MARKER_PREFIX}{label}", frame=view.index)
        marker.camera = camera
        cameras.append(camera)
        markers.append(marker)

    scene["direction_count"] = len(markers)
    scene["view_sampling"] = "latitude rings; nearest unit-vector selection"
    scene["view_elevation_range_degrees"] = [-75.0, 75.0]
    scene["billboard_orthographic_scale_m"] = ORTHOGRAPHIC_SCALE_METERS
    scene.frame_start = 0
    scene.frame_end = len(markers) - 1
    preview_index = min(
        range(len(cameras)),
        key=lambda index: abs(float(cameras[index]["view_elevation_degrees"]) - 10.0)
        + abs(float(cameras[index]["view_azimuth_degrees_clockwise"])) / 360.0,
    )
    scene.frame_set(preview_index)
    scene.camera = cameras[preview_index]
    return markers
