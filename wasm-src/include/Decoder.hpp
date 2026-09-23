#pragma once

#include <cstdint>

extern "C" {

int decode_points(
    const uint8_t* input,
    uint32_t inputSize,
    float* output,
    uint32_t maxPoints
);

}