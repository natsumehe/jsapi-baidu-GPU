import {
    BaiduMap
} from "../map/BaiduMap";

import {
    SpatialEngine
} from "../engine/SpatialEngine";


export class Engine {

    private map!:
        BaiduMap;

    private spatial!:
        SpatialEngine;


    async initialize():
        Promise<void> {

        this.map =
            new BaiduMap({

                container:
                    "map_container",

                center: {

                    lng:
                        122.032722,

                    lat:
                        29.95
                },

                zoom:
                    12
            });


        this.spatial =
            new SpatialEngine({

                map:
                    this.map,

                origin: {

                    longitude:
                        121.8,

                    latitude:
                        29.95,

                    height:
                        0
                }
            });


        this.map.onCameraChanged(

            () => {

                void this.spatial
                    .cameraChanged();
            }
        );


        await this.spatial
            .initialize();
    }


    getMap():
        BMapGL.Map {

        return this.map.getMap();
    }


    getSpatialEngine():
        SpatialEngine {

        return this.spatial;
    }


    destroy():
        void {

        this.spatial.destroy();
    }
}