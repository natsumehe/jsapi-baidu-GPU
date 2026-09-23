import json, math, os, shutil
from pathlib import Path
ROOT=Path('/tmp/ysfix/baidu')
GIS=ROOT/'public/data/gis'
ROUTE=ROOT/'public/data/simulation/yangshan_phase4/agv_routes_gis.json'
OUT=Path('/mnt/data/yangshan_bd09_fix'); OUT.mkdir(exist_ok=True)

def wgs_to_gcj(lon,lat):
    a=6378245.0; ee=0.00669342162296594323
    if lon<72.004 or lon>137.8347 or lat<0.8293 or lat>55.8271: return lon,lat
    x=lon-105; y=lat-35
    dlat=-100+2*x+3*y+.2*y*y+.1*x*y+.2*math.sqrt(abs(x))
    dlat+=(20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
    dlat+=(20*math.sin(y*math.pi)+40*math.sin(y/3*math.pi))*2/3
    dlat+=(160*math.sin(y/12*math.pi)+320*math.sin(y*math.pi/30))*2/3
    dlng=300+x+2*y+.1*x*x+.1*x*y+.1*math.sqrt(abs(x))
    dlng+=(20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
    dlng+=(20*math.sin(x*math.pi)+40*math.sin(x/3*math.pi))*2/3
    dlng+=(150*math.sin(x/12*math.pi)+300*math.sin(x/30*math.pi))*2/3
    rad=lat*math.pi/180; magic=1-ee*math.sin(rad)**2; s=math.sqrt(magic)
    dlat=dlat*180/(a*(1-ee)/(magic*s)*math.pi)
    dlng=dlng*180/(a/s*math.cos(rad)*math.pi)
    return lon+dlng,lat+dlat

def gcj_to_bd(lon,lat):
    z=math.sqrt(lon*lon+lat*lat)+0.00002*math.sin(lat*math.pi*3000/180)
    t=math.atan2(lat,lon)+0.000003*math.cos(lon*math.pi*3000/180)
    return z*math.cos(t)+0.0065,z*math.sin(t)+0.006

def wgs_to_bd(p): return gcj_to_bd(*wgs_to_gcj(*p))

def transform_coords(coords):
    if isinstance(coords,list):
        if len(coords)>=2 and isinstance(coords[0],(int,float)) and isinstance(coords[1],(int,float)):
            lon,lat=wgs_to_bd((coords[0],coords[1])); return [lon,lat,*coords[2:]]
        return [transform_coords(x) for x in coords]
    return coords

def convert_geojson(src,dst):
    d=json.load(open(src,encoding='utf-8'))
    for f in d.get('features',[]):
        if f.get('geometry') and 'coordinates' in f['geometry']:
            f['geometry']['coordinates']=transform_coords(f['geometry']['coordinates'])
    d['crs']={'type':'name','properties':{'name':'BD09'}}
    d.setdefault('properties',{})
    d['properties']['coordinate_system']='BD09'
    d['properties']['source_coordinate_system']='WGS84/CRS84'
    d['properties']['registration']='WGS84 -> GCJ02 -> BD09; whole dataset transformed before Baidu JSAPI rendering'
    d['properties']['baidu_anchor']={'longitude':122.032598,'latitude':30.662465}
    json.dump(d,open(dst,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))

for name in ['container_yards.geojson','road_network.geojson','operational_polygons.geojson']:
    convert_geojson(GIS/name, OUT/name)

# Preserve original route metadata but convert every geographic point to BD09 and recompute local meters.
d=json.load(open(ROUTE,encoding='utf-8'))
origin_lon,origin_lat=122.032598,30.662465
R=6378137.0
c=math.cos(math.radians(origin_lat))
def local(lon,lat):
    return [(math.radians(lon-origin_lon)*R*c), (math.radians(lat-origin_lat)*R)]
for route in d['routes']:
    for phase in route['phases']:
        for p in phase['points']:
            p['longitude'],p['latitude']=wgs_to_bd((p['longitude'],p['latitude']))
            p['x'],p['y']=local(p['longitude'],p['latitude'])
d['coordinateSystem']={'type':'BD09/local-meter','origin':{'longitude':origin_lon,'latitude':origin_lat}}
d['registration']={
 'sourceDataCRS':'WGS84/CRS84',
 'pipeline':'WGS84 -> GCJ02 -> BD09',
 'baiduBD09':{'longitude':origin_lon,'latitude':origin_lat},
 'userQGIS3857':{'x':13583417,'y':3688475},
 'verifiedQGIS3857':{'x':13583417,'y':3588475},
 'warning':'The uploaded GeoJSON is CRS84/WGS84. The user-provided Y=3688475 is inconsistent with Yangshan; 3588475 is the WebMercator value that maps near the Baidu anchor.'
}
d['dataStatus']='REGISTERED_BD09'
json.dump(d,open(OUT/'agv_routes_gis.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))

# Also convert the original fusion datasets for reference.
for srcname in ['yangshangang_georeferenced_fusion_v3.geojson','yangshangang_georeferenced_fusion_v2.geojson','yangshangang_fused.geojson','yangshangang_container_areas.geojson','yangshangang_road_centerlines_final.geojson']:
    src=Path('/mnt/data/yangshan_source')/srcname
    if src.exists(): convert_geojson(src,OUT/srcname)

print('done')
