#include <cstdint>

struct AABB {

    float minX;
    float maxX;

    float minY;
    float maxY;

    float minZ;
    float maxZ;
};

extern "C"
bool point_in_aabb(
    float x,
    float y,
    float z,
    const AABB* box
) {

    return
        x >= box->minX &&
        x <= box->maxX &&

        y >= box->minY &&
        y <= box->maxY &&

        z >= box->minZ &&
        z <= box->maxZ;
}