#include "Decoder.hpp"
#include "spatial_engine.hpp"

extern "C" {

int wasm_decode_tile(
    const uint8_t* data,
    uint32_t length
) {

    return decode_tile(
        data,
        length
    );
}


int wasm_decode_points(
    const uint8_t* data,
    uint32_t length,
    float* output,
    uint32_t maxPoints
) {

    return decode_points(
        data,
        length,
        output,
        maxPoints
    );
}

}