export default async function createSpatialModule() {
  const memory = new Uint8Array(1);

  return {
    _malloc(size) {
      return 0;
    },
    _free() {
      return;
    },
    HEAPU8: memory,
    HEAPF32: new Float32Array(),
    HEAPU32: new Uint32Array(),
    decode_points() {
      return 0;
    }
  };
}
