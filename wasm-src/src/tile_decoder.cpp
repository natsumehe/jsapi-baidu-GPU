#include "../include/tile_format.hpp"
#include "../include/spatial_engine.hpp"

#include <cstring>
#include <vector>

namespace {

std::vector<float>
g_positions;

std::vector<uint8_t>
g_colors;

uint32_t
g_pointCount = 0;

constexpr uint32_t
MAGIC =
    0x504F5254;

}

extern "C"
int decode_tile(
    const uint8_t* data,
    uint32_t length
) {

    if (
        data == nullptr
    ) {

        return -1;
    }

    if (
        length <
        sizeof(TileHeader)
    ) {

        return -2;
    }

    TileHeader header{};

    std::memcpy(
        &header,
        data,
        sizeof(TileHeader)
    );

    if (
        header.magic != MAGIC
    ) {

        return -3;
    }

    const uint64_t required =
        sizeof(TileHeader)
        +
        static_cast<uint64_t>(
            header.pointCount
        )
        *
        sizeof(PackedPoint);

    if (
        required >
        length
    ) {

        return -4;
    }

    g_pointCount =
        header.pointCount;

    g_positions.resize(
        g_pointCount * 3
    );

    g_colors.resize(
        g_pointCount * 4
    );

    const auto* points =
        reinterpret_cast<
            const PackedPoint*
        >(
            data +
            sizeof(TileHeader)
        );

    for (
        uint32_t i = 0;
        i < g_pointCount;
        ++i
    ) {

        const PackedPoint& p =
            points[i];

        /*
         * GPU positions
         */

        g_positions[
            i * 3
        ] = p.x;

        g_positions[
            i * 3 + 1
        ] = p.y;

        g_positions[
            i * 3 + 2
        ] = p.z;

        /*
         * RGBA
         */

        g_colors[
            i * 4
        ] = p.r;

        g_colors[
            i * 4 + 1
        ] = p.g;

        g_colors[
            i * 4 + 2
        ] = p.b;

        g_colors[
            i * 4 + 3
        ] = 255;
    }

    return 0;
}

extern "C"
uint32_t get_point_count()
{
    return g_pointCount;
}

extern "C"
float* get_positions_ptr()
{
    return g_positions.data();
}

extern "C"
uint8_t* get_colors_ptr()
{
    return g_colors.data();
}