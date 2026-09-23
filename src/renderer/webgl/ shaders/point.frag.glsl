#version 300 es

precision highp float;

in vec4 v_color;

out vec4 outColor;

void main()
{
    vec2 p =
        gl_PointCoord -
        vec2(0.5);

    float distance =
        dot(p, p);

    if (
        distance > 0.25
    ) {

        discard;
    }

    outColor =
        v_color;
}