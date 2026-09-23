cmake_minimum_required(
    VERSION 3.20
)

project(
    spatial
    LANGUAGES CXX
)

set(
    CMAKE_CXX_STANDARD
    20
)

set(
    CMAKE_CXX_STANDARD_REQUIRED
    ON
)


add_executable(

    spatial

    src/bindings.cpp

    src/tile_decoder.cpp

    src/decoder.cpp

    src/coordinate.cpp

    src/culling.cpp

    src/lod.cpp
)


target_include_directories(

    spatial

    PRIVATE

    ${CMAKE_CURRENT_SOURCE_DIR}/include
)


target_compile_options(

    spatial

    PRIVATE

    -O3
)


target_link_options(

    spatial

    PRIVATE

    "-O3"

    "-sWASM=1"

    "-sMODULARIZE=1"

    "-sEXPORT_ES6=1"

    "-sALLOW_MEMORY_GROWTH=1"

    "-sENVIRONMENT=web,worker"

    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_decode_tile','_get_point_count','_get_positions_ptr','_get_colors_ptr','_decode_points','_geo_to_local','_point_in_aabb','_calculate_lod']"

    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPF32']"
)


set_target_properties(

    spatial

    PROPERTIES

    SUFFIX ".js"
)