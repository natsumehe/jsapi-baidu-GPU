#include <cmath>
#include <cstdint>

extern "C"
uint32_t calculate_lod(
    float distance
) {

    if (
        distance < 100.0f
    ) {

        return 4;
    }

    if (
        distance < 500.0f
    ) {

        return 3;
    }

    if (
        distance < 2000.0f
    ) {

        return 2;
    }

    if (
        distance < 5000.0f
    ) {

        return 1;
    }

    return 0;
}