#version 300 es

precision highp float;

layout(location = 0)
in vec3 a_position;

layout(location = 1)
in vec4 a_color;

uniform mat4 u_matrix;

out vec4 v_color;

void main()
{
    gl_Position =
        u_matrix *
        vec4(
            a_position,
            1.0
        );

    gl_PointSize =
        5.0;

    v_color =
        a_color;
}