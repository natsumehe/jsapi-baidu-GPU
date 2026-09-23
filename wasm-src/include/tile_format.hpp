#pragma once

#include <cstdint>

#pragma pack(push, 1)

struct TileHeader {

    uint32_t magic;

    uint32_t version;

    uint32_t pointCount;

    float originX;

    float originY;

    float originZ;
};

struct PackedPoint {

    float x;

    float y;

    float z;

    uint8_t r;

    uint8_t g;

    uint8_t b;

    uint8_t type;
};

#pragma pack(pop)

static_assert(
    sizeof(TileHeader) == 24
);

static_assert(
    sizeof(PackedPoint) == 16
);