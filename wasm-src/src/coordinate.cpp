#include <cmath>

extern "C"
void geo_to_local(
    double longitude,
    double latitude,
    double originLongitude,
    double originLatitude,
    double* x,
    double* y
) {

    constexpr double R =
        6378137.0;

    constexpr double PI =
        3.14159265358979323846;

    const double lat0 =
        originLatitude *
        PI /
        180.0;

    const double dLon =
        (
            longitude -
            originLongitude
        )
        *
        PI /
        180.0;

    const double dLat =
        (
            latitude -
            originLatitude
        )
        *
        PI /
        180.0;

    *x =
        dLon *
        R *
        std::cos(lat0);

    *y =
        dLat *
        R;
}