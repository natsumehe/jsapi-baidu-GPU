import type {
    DecodedTile
} from "../data/runtime/TileTypes";

import type {
    SpatialWasmModule
} from "./WasmTypes";


export class WasmEngine {

    private module:
        SpatialWasmModule |
        null = null;


    async initialize():
        Promise<boolean> {

        if (
            this.module
        ) {

            return true;
        }

        try {

            const createModule =
                await import(
                    "./spatial.js"
                );

            const module =
                await createModule.default({

                    locateFile:
                        (file: string) =>
                            `/wasm/${file}`
                });


            if (

                typeof
                    module._decode_tile !==
                    "function"

                ||

                typeof
                    module._get_point_count !==
                    "function"

                ||

                typeof
                    module._get_positions_ptr !==
                    "function"

                ||

                typeof
                    module._get_colors_ptr !==
                    "function"

            ) {

                return false;
            }


            this.module =
                module as
                SpatialWasmModule;

            return true;

        } catch (
            error
        ) {

            console.warn(

                "WASM initialization failed; JS fallback will be used.",

                error
            );

            return false;
        }
    }


    isReady():
        boolean {

        return (
            this.module !==
            null
        );
    }


    decodeTile(

        buffer:
            ArrayBuffer,

        id:
            string

    ):
        DecodedTile {

        const wasm =
            this.module;

        if (
            !wasm
        ) {

            throw new Error(
                "WASM is not initialized."
            );
        }


        const input =
            new Uint8Array(
                buffer
            );


        const inputPtr =
            wasm._malloc(
                input.byteLength
            );


        try {

            wasm.HEAPU8.set(
                input,
                inputPtr
            );


            const resultCode =
                wasm._decode_tile(

                    inputPtr,

                    input.byteLength
                );


            if (
                resultCode !==
                0
            ) {

                throw new Error(

                    `WASM tile decoder returned ${resultCode}.`
                );
            }


            const count =
                wasm._get_point_count();


            const positionPtr =
                wasm._get_positions_ptr();


            const colorPtr =
                wasm._get_colors_ptr();


            const positions =
                wasm.HEAPF32.slice(

                    positionPtr /
                    4,

                    positionPtr /
                    4 +
                    count * 3
                );


            const colors =
                wasm.HEAPU8.slice(

                    colorPtr,

                    colorPtr +
                    count * 4
                );


            return {

                id,

                count,

                positions,

                colors
            };

        } finally {

            wasm._free(
                inputPtr
            );
        }
    }
}