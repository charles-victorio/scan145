"""
Slice a GLB flat at a world-space Y, discarding everything above and cutting
triangles that straddle the plane so the boundary is a clean, exact edge (not
a jagged stair-step from whole-triangle removal). Writes a new file; the
source is left untouched.

Only appends new accessors/bufferViews (interpolated position+UV for the cut
triangles, plus the filtered index buffers) to the end of the binary blob —
materials and embedded images are preserved byte-for-byte. Old, now-unused
accessors/bufferViews are left in place as harmless dead data rather than
attempting a full buffer repack.

Usage:
    python3 trim_height.py <src.glb> <dst.glb> [cutoff_y]

Requires: pygltflib, numpy
"""

import sys
import numpy as np
import pygltflib
from pygltflib import GLTF2

COMPONENT_DTYPES = {
    5120: np.int8, 5121: np.uint8, 5122: np.int16,
    5123: np.uint16, 5125: np.uint32, 5126: np.float32,
}
TYPE_COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def decode_accessor(gltf: GLTF2, blob: bytes, accessor_index: int) -> np.ndarray:
    acc = gltf.accessors[accessor_index]
    bv = gltf.bufferViews[acc.bufferView]
    dtype = COMPONENT_DTYPES[acc.componentType]
    ncomp = TYPE_COUNTS[acc.type]
    start = (bv.byteOffset or 0) + (acc.byteOffset or 0)
    count = acc.count * ncomp
    arr = np.frombuffer(blob, dtype=dtype, count=count, offset=start)
    arr = arr.reshape(acc.count, ncomp) if ncomp > 1 else arr
    return arr.copy()


def clip_triangle(pos3: np.ndarray, uv3: np.ndarray, cutoff: float):
    # Sutherland-Hodgman clip of one triangle against the half-space y<=cutoff.
    # Preserves winding order; returns a convex polygon (0, 3, or 4 verts).
    inside = pos3[:, 1] <= cutoff
    out_pos, out_uv = [], []
    for i in range(3):
        curr_p, curr_uv, curr_in = pos3[i], uv3[i], inside[i]
        prev_p, prev_uv, prev_in = pos3[i - 1], uv3[i - 1], inside[i - 1]
        if curr_in:
            if not prev_in:
                t = (cutoff - prev_p[1]) / (curr_p[1] - prev_p[1])
                out_pos.append(prev_p + t * (curr_p - prev_p))
                out_uv.append(prev_uv + t * (curr_uv - prev_uv))
            out_pos.append(curr_p)
            out_uv.append(curr_uv)
        elif prev_in:
            t = (cutoff - prev_p[1]) / (curr_p[1] - prev_p[1])
            out_pos.append(prev_p + t * (curr_p - prev_p))
            out_uv.append(prev_uv + t * (curr_uv - prev_uv))
    return out_pos, out_uv


def main():
    src, dst = sys.argv[1], sys.argv[2]
    cutoff = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0

    gltf = GLTF2().load(src)
    blob = bytearray(gltf.binary_blob())
    extra = bytearray()
    buffer_index = 0  # assumes a single embedded buffer, as poly.cam exports

    def append_buffer(arr_bytes: bytes, target=None) -> int:
        pad = (-len(extra)) % 4  # keep bufferViews 4-byte aligned
        extra.extend(b"\x00" * pad)
        offset = len(blob) + len(extra)
        extra.extend(arr_bytes)
        bv = pygltflib.BufferView(buffer=buffer_index, byteOffset=offset, byteLength=len(arr_bytes))
        if target is not None:
            bv.target = target
        gltf.bufferViews.append(bv)
        return len(gltf.bufferViews) - 1

    for mesh in gltf.meshes:
        for prim in mesh.primitives:
            positions = decode_accessor(gltf, blob, prim.attributes.POSITION).astype(np.float32)
            uvs = decode_accessor(gltf, blob, prim.attributes.TEXCOORD_0).astype(np.float32)
            indices = decode_accessor(gltf, blob, prim.indices)

            tris = indices.reshape(-1, 3)
            tri_y = positions[tris][:, :, 1]
            all_in = (tri_y <= cutoff).all(axis=1)
            all_out = (tri_y > cutoff).all(axis=1)
            straddling = ~all_in & ~all_out

            new_positions = [positions]
            new_uvs = [uvs]
            next_vertex_index = len(positions)
            out_tris = list(tris[all_in])

            for tri in tris[straddling]:
                poly_pos, poly_uv = clip_triangle(positions[tri], uvs[tri], cutoff)
                if len(poly_pos) < 3:
                    continue
                poly_pos = np.array(poly_pos, dtype=np.float32)
                poly_uv = np.array(poly_uv, dtype=np.float32)
                new_positions.append(poly_pos)
                new_uvs.append(poly_uv)
                base = next_vertex_index
                n = len(poly_pos)
                next_vertex_index += n
                for k in range(1, n - 1):  # fan-triangulate the convex result
                    out_tris.append([base, base + k, base + k + 1])

            all_positions = np.concatenate(new_positions, axis=0)
            all_uvs = np.concatenate(new_uvs, axis=0)
            out_indices = np.array(out_tris, dtype=np.int64).reshape(-1)
            idx_dtype = np.uint32 if all_positions.shape[0] > 65535 else np.uint16
            out_indices = out_indices.astype(idx_dtype)

            pos_bv = append_buffer(all_positions.tobytes(), pygltflib.ARRAY_BUFFER)
            gltf.accessors.append(pygltflib.Accessor(
                bufferView=pos_bv, componentType=5126, count=len(all_positions), type="VEC3",
                min=all_positions.min(axis=0).tolist(), max=all_positions.max(axis=0).tolist(),
            ))
            prim.attributes.POSITION = len(gltf.accessors) - 1

            uv_bv = append_buffer(all_uvs.tobytes(), pygltflib.ARRAY_BUFFER)
            gltf.accessors.append(pygltflib.Accessor(
                bufferView=uv_bv, componentType=5126, count=len(all_uvs), type="VEC2",
            ))
            prim.attributes.TEXCOORD_0 = len(gltf.accessors) - 1

            idx_bv = append_buffer(out_indices.tobytes(), pygltflib.ELEMENT_ARRAY_BUFFER)
            gltf.accessors.append(pygltflib.Accessor(
                bufferView=idx_bv,
                componentType=5125 if idx_dtype == np.uint32 else 5123,
                count=len(out_indices), type="SCALAR",
                min=[int(out_indices.min())] if len(out_indices) else [0],
                max=[int(out_indices.max())] if len(out_indices) else [0],
            ))
            prim.indices = len(gltf.accessors) - 1

            print(f"prim: {len(tris)} tris -> {len(out_tris)} tris, "
                  f"{len(positions)} verts -> {len(all_positions)} verts "
                  f"({straddling.sum()} straddling)")

    full_blob = bytes(blob) + bytes(extra)
    gltf.set_binary_blob(full_blob)
    gltf.buffers[buffer_index].byteLength = len(full_blob)
    gltf.save(dst)
    print("wrote", dst)


if __name__ == "__main__":
    main()
