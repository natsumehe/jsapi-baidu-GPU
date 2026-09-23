struct Params {
    minX: f32,
    maxX: f32,
    minY: f32,
    maxY: f32,
    minZ: f32,
    maxZ: f32,
    count: f32,
    padding: f32,
};

@group(0) @binding(0)
var<storage, read> positions: array<f32>;

@group(0) @binding(1)
var<storage, read_write> visibility: array<u32>;

@group(0) @binding(2)
var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;

    if (f32(index) >= params.count) {
        return;
    }

    let base = index * 3u;
    let x = positions[base];
    let y = positions[base + 1u];
    let z = positions[base + 2u];

    let inside =
        x >= params.minX && x <= params.maxX &&
        y >= params.minY && y <= params.maxY &&
        z >= params.minZ && z <= params.maxZ;

    visibility[index] = select(0u, 1u, inside);
}
