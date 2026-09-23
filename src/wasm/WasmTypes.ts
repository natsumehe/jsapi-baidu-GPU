export interface SpatialWasmModule {

    _malloc(
        size:
            number
    ):
        number;

    _free(
        ptr:
            number
    ):
        void;

    _decode_tile(
        ptr:
            number,

        length:
            number
    ):
        number;

    _get_point_count():
        number;

    _get_positions_ptr():
        number;

    _get_colors_ptr():
        number;

    HEAPU8:
        Uint8Array;

    HEAPF32:
        Float32Array;
}


export interface DecodedWasmResult {

    id:
        string;

    count:
        number;

    positions:
        Float32Array;

    colors:
        Uint8Array;
}