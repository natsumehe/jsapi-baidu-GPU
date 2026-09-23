#include "Decoder.hpp"

#include <cstring>

struct PointRecord {

    float x;
    float y;
    float z;

    uint8_t r;
    uint8_t g;
    uint8_t b;
};

extern "C"
int decode_points(
    const uint8_t* input,
    uint32_t inputSize,
    float* output,
    uint32_t maxPoints
) {

    constexpr uint32_t RECORD_SIZE = 15;

    uint32_t available =
        inputSize / RECORD_SIZE;

    uint32_t count =
        available < maxPoints
        ? available
        : maxPoints;

    for (uint32_t i = 0; i < count; ++i) {

        const uint8_t* ptr =
            input + i * RECORD_SIZE;

        PointRecord point;

        std::memcpy(
            &point.x,
            ptr,
            sizeof(float)
        );

        std::memcpy(
            &point.y,
            ptr + 4,
            sizeof(float)
        );

        std::memcpy(
            &point.z,
            ptr + 8,
            sizeof(float)
        );

        output[i * 3 + 0] =
            point.x;

        output[i * 3 + 1] =
            point.y;

        output[i * 3 + 2] =
            point.z;
    }

    return static_cast<int>(count);
}