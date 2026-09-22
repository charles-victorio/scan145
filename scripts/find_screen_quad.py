"""
Locate a flat-panel "screen" quad in a glTF mesh by finding its largest pair
of coplanar faces (a thin slab's front/back) and reporting the rectangle's
center/size in the same recentered local frame main.ts uses for `laptop`
(i.e. relative to the model's own bounding-box center, before any of
LAPTOP_POSITION/ROTATION_Y/SCALE is applied).

This was used once, by hand, to find the Lenovo model's screen coordinates
baked into main.ts as SCREEN_LOCAL_CENTER/WIDTH/HEIGHT. Re-run and re-eyeball
the output if the laptop asset ever changes — it's not fully automatic
(you still have to pick which face-area cluster is actually the display
vs. e.g. the keyboard deck or chassis panels).

Usage:
    python3 find_screen_quad.py <path/to/scene.gltf-or-glb>

Requires: trimesh, numpy
"""

import sys
import numpy as np
import trimesh


def main():
    path = sys.argv[1]
    scene = trimesh.load(path, process=False)
    geom = list(scene.geometry.values())[0]
    for node in scene.graph.nodes_geometry:
        transform, _ = scene.graph[node]
        geom = geom.copy()
        geom.apply_transform(transform)

    box_min, box_max = geom.bounds
    center = (box_min + box_max) / 2
    print("model bounds:", box_min.round(3), box_max.round(3))
    print("recenter offset (model bbox center):", center.round(3))

    face_normals = geom.face_normals
    face_areas = geom.area_faces
    order = np.argsort(-face_areas)

    print("\nlargest faces by area (inspect these for the screen panel):")
    for i in order[:20]:
        centroid = geom.triangles_center[i]
        print(
            f"  face {i}: area={face_areas[i]:.3f} "
            f"normal={face_normals[i].round(3)} "
            f"centroid={centroid.round(3)} "
            f"recentered={ (centroid - center).round(3) }"
        )

    print(
        "\nOnce you've identified the two coplanar faces forming the screen "
        "(same normal, same plane offset, largest area), pass their indices "
        "below to print the exact rectangle:"
    )
    if len(sys.argv) > 2:
        idxs = [int(a) for a in sys.argv[2:]]
        verts = set()
        for i in idxs:
            verts.update(geom.faces[i])
        pts = geom.vertices[list(verts)]
        recentered = pts - center
        print(f"\nfaces {idxs}:")
        print("  corners (recentered):", recentered.round(3).tolist())
        print("  center:", recentered.mean(axis=0).round(3))
        print("  size (w,h):", (recentered.max(axis=0) - recentered.min(axis=0)).round(3))


if __name__ == "__main__":
    main()
