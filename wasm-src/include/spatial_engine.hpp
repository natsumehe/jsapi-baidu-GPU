#pragma once

#include <cstdint>

extern "C" {

int decode_tile(
    const uint8_t* data,
    uint32_t length
);

uint32_t get_point_count();

float* get_positions_ptr();

uint8_t* get_colors_ptr();

}