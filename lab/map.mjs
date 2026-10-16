const ORIGIN={lng:122.032598,lat:30.662465};
const M_PER_LNG=111320*Math.cos(ORIGIN.lat*Math.PI/180),M_PER_LAT=110540;
export class HybridMapAdapter {
  constructor(host,background){
    this.host=host;this.background=background;this.map=null;
    this.zoom=2;this.panX=0;this.panY=0;this.name='Offline grid (no remote basemap)';
    this.onChange=()=>{};
    this.installPointer();
  }
  async initialize(ak){
    if(!ak){this.paint();return false;}
    try{
      await new Promise((resolve,reject)=>{
        if(window.BMapGL?.Map){resolve();return;}
        const callback='__labBaiduReady';
        const timer=setTimeout(()=>{delete window[callback];reject(Error('Baidu JSAPI timeout'));},9000);
        window[callback]=()=>{clearTimeout(timer);delete window[callback];resolve();};
        const s=document.createElement('script');s.src='https://api.map.baidu.com/api?v=4.0&ak='+encodeURIComponent(ak)+'&callback='+callback;
        s.onerror=()=>{clearTimeout(timer);delete window[callback];reject(Error('Baidu JSAPI network error'));};
        document.head.appendChild(s);
      });
      const B=window.BMapGL;
      if(!B?.Map)throw Error('BMapGL compatibility namespace missing after JSAPI 4.0 load');
      B.apiVersion='gl';
      this.map=new B.Map(this.background,{enableMapClick:false});
      this.map.centerAndZoom(new B.Point(ORIGIN.lng,ORIGIN.lat),12);
      // Fit the actual abstract test extent. Zoom 16 would put almost every
      // generated object outside the viewport after switching basemaps.
      const sw=new B.Point(ORIGIN.lng-3300/M_PER_LNG,ORIGIN.lat-1550/M_PER_LAT),
        ne=new B.Point(ORIGIN.lng+3300/M_PER_LNG,ORIGIN.lat+1550/M_PER_LAT);
      try{this.map.setViewport?.([sw,ne]);}catch(e){console.warn('Baidu fit extent fallback',e);}
      this.map.enableScrollWheelZoom?.(true);
      for(const event of ['moveend','zoomend','moving','zooming','resize','tilesloaded','load'])
        this.map.addEventListener(event,()=>this.onChange());
      this.name='Baidu JSAPI (live basemap; API availability varies)';
      this.host.classList.add('baidu-active');
      this.bringOverlayToFront(this.host.querySelector('#overlay'));
      this.onChange();requestAnimationFrame(()=>requestAnimationFrame(()=>this.onChange()));return true;
    }catch(e){this.name='Offline fallback ('+String(e)+')';this.paint();return false;}
  }
  bringOverlayToFront(canvas){
    if(!(canvas instanceof HTMLCanvasElement))return;
    // Canvas remains a sibling above the map container, never becomes a child
    // of the Baidu map DOM (which can be replaced by the SDK during init).
    this.host.appendChild(canvas);
    canvas.style.zIndex='100';canvas.style.pointerEvents='none';
  }
  installPointer(){
    let drag=null;
    this.host.addEventListener('pointerdown',e=>{if(this.map)return;drag=[e.clientX,e.clientY,this.panX,this.panY];this.host.setPointerCapture(e.pointerId);});
    this.host.addEventListener('pointermove',e=>{if(!drag)return;this.panX=drag[2]+e.clientX-drag[0];this.panY=drag[3]+e.clientY-drag[1];this.paint();this.onChange();});
    this.host.addEventListener('pointerup',()=>drag=null);
    this.host.addEventListener('wheel',e=>{if(this.map)return;e.preventDefault();this.zoom=Math.max(.5,Math.min(12,this.zoom*(e.deltaY>0?.82:1.2)));this.paint();this.onChange();},{passive:false});
  }
  setPan(x,y){this.panX=x;this.panY=y;this.paint();this.onChange();}
  transform(){
    const width=this.host.clientWidth,height=this.host.clientHeight;
    if(this.map){
      const B=window.BMapGL;
      const pixel=(x,y)=>{const pt=new B.Point(ORIGIN.lng+x/M_PER_LNG,ORIGIN.lat+y/M_PER_LAT);
        // pointToPixel gives pixel coordinates relative to this map container;
        // pointToOverlayPixel may use a different overlay-pane origin.
        const p=this.map.pointToPixel(pt);return [p.x,p.y];};
      const a=pixel(0,0),b=pixel(100,0),c=pixel(0,100);
      return {origin:a,basisX:[(b[0]-a[0])/100,(b[1]-a[1])/100],basisY:[(c[0]-a[0])/100,(c[1]-a[1])/100]};
    }
    const scale=.13*this.zoom;
    return {origin:[width/2+this.panX,height/2+this.panY],basisX:[scale,0],basisY:[0,-scale]};
  }
  viewportBounds(margin=1.0){
    const w=this.host.clientWidth,h=this.host.clientHeight,t=this.transform();
    const [a,b]=t.basisX,[c,d]=t.basisY,det=a*d-b*c;
    if(Math.abs(det)<1e-8)return {minX:-3200,maxX:3200,minY:-1450,maxY:1450};
    const inv=(x,y)=>{const dx=x-t.origin[0],dy=y-t.origin[1];return [(d*dx-c*dy)/det,(-b*dx+a*dy)/det];};
    const pts=[inv(0,0),inv(w,0),inv(w,h),inv(0,h)];
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    return {minX:minX-(maxX-minX)*(margin-1)/2,maxX:maxX+(maxX-minX)*(margin-1)/2,
      minY:minY-(maxY-minY)*(margin-1)/2,maxY:maxY+(maxY-minY)*(margin-1)/2};
  }
  paint(){
    if(this.map)return;
    const el=this.background;
    let grid=el.querySelector('.offline-grid');
    if(!grid){
      grid=document.createElement('div');grid.className='offline-grid';
      grid.innerHTML='<span>抽象空间计算实验坐标系</span><small>Point · LineString · Polygon · WebGL / WebGPU</small>';
      el.appendChild(grid);
    }
    grid.style.backgroundSize=`${30*this.zoom}px ${30*this.zoom}px`;
    grid.style.backgroundPosition=`${this.panX}px ${this.panY}px`;
  }
}
