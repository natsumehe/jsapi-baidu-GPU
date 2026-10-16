/** WebGL Point / LineString / Polygon renderer. Each object becomes 1/2/6
 * vertices respectively; geometries are NOT all painted as gl.POINTS.
 * A/B/C/D/E share this exact renderer and geometry expansion code.
 */
const VERTICES=[1,2,6];
export class PortRenderer {
  constructor(canvas){
    this.canvas=canvas;
    this.gl=canvas.getContext('webgl2',{alpha:true,antialias:false,preserveDrawingBuffer:false})||
      canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:false});
    if(!this.gl)throw Error('WebGL unavailable');
    const gl=this.gl;
    const vs=this.shader(gl.VERTEX_SHADER,`attribute vec2 a_pos; attribute vec4 a_color;
      uniform vec2 u_origin;uniform vec2 u_basisX;uniform vec2 u_basisY;uniform vec2 u_viewport;
      varying vec4 v_color;
      void main(){vec2 screen=u_origin+a_pos.x*u_basisX+a_pos.y*u_basisY;
      gl_Position=vec4(screen.x/u_viewport.x*2.0-1.0,1.0-screen.y/u_viewport.y*2.0,0.0,1.0);
      gl_PointSize=4.0;v_color=a_color;}`);
    const fs=this.shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec4 v_color;
      void main(){gl_FragColor=v_color;}`);
    this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
    gl.deleteShader(vs);gl.deleteShader(fs);
    this.loc={pos:gl.getAttribLocation(this.program,'a_pos'),color:gl.getAttribLocation(this.program,'a_color'),
      origin:gl.getUniformLocation(this.program,'u_origin'),basisX:gl.getUniformLocation(this.program,'u_basisX'),
      basisY:gl.getUniformLocation(this.program,'u_basisY'),viewport:gl.getUniformLocation(this.program,'u_viewport')};
    this.groups=VERTICES.map((n,kind)=>({kind,vertexMultiplier:n,pos:gl.createBuffer(),color:gl.createBuffer(),objects:0,capacity:0}));
    this.length=0;this.uploadMs=0;this.uploadBytes=0;this.drawCalls=0;
  }
  shader(type,source){const g=this.gl,s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);
    if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;}
  reset(size,geometry='mixed'){
    const gl=this.gl;this.length=0;this.uploadMs=0;this.uploadBytes=0;this.drawCalls=0;
    this.geometry=geometry;
    for(const g of this.groups){
      g.objects=0;
      const maxObjects=geometry==='mixed'?Math.ceil(size/3)+2:geometry===(['point','line','polygon'][g.kind])?size:0;
      g.capacity=maxObjects;
      gl.bindBuffer(gl.ARRAY_BUFFER,g.pos);gl.bufferData(gl.ARRAY_BUFFER,maxObjects*g.vertexMultiplier*8,gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,g.color);gl.bufferData(gl.ARRAY_BUFFER,maxObjects*g.vertexMultiplier*4,gl.DYNAMIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,null);
  }
  append(chunk){
    const gl=this.gl,t=performance.now();const parts=this.groups.map(()=>[]);
    for(let i=0;i<chunk.count;i++){
      const kind=chunk.types[i];if(kind>2)throw Error('Invalid primitive type '+kind);
      parts[kind].push(i);
    }
    let appended=0;
    for(const g of this.groups){
      const indices=parts[g.kind],n=indices.length;if(!n)continue;
      if(g.objects+n>g.capacity)throw Error(`GPU ${g.kind} buffer capacity exceeded`);
      const vertices=n*g.vertexMultiplier,positions=new Float32Array(vertices*2),colors=new Uint8Array(vertices*4);
      for(let j=0;j<n;j++){
        const i=indices[j],x=chunk.positions[i*2],y=chunk.positions[i*2+1];
        // Fixed-size abstract geometry around each object centre. All culling
        // strategies operate on the centre consistently; +/-8 m boundary halo.
        const dx=g.kind===1?8:4,dy=g.kind===1?3:3;
        const offsets=g.kind===0?[[0,0]]:g.kind===1?[[-dx,-dy],[dx,dy]]:
          [[-dx,-dy],[dx,-dy],[dx,dy],[-dx,-dy],[dx,dy],[-dx,dy]];
        for(let k=0;k<offsets.length;k++){
          const p=(j*g.vertexMultiplier+k)*2,c=(j*g.vertexMultiplier+k)*4;
          positions[p]=x+offsets[k][0];positions[p+1]=y+offsets[k][1];
          colors.set(chunk.colors.subarray(i*4,i*4+4),c);
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,g.pos);gl.bufferSubData(gl.ARRAY_BUFFER,g.objects*g.vertexMultiplier*8,positions);
      gl.bindBuffer(gl.ARRAY_BUFFER,g.color);gl.bufferSubData(gl.ARRAY_BUFFER,g.objects*g.vertexMultiplier*4,colors);
      g.objects+=n;appended+=n;this.uploadBytes+=positions.byteLength+colors.byteLength;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,null);this.length+=appended;this.uploadMs+=performance.now()-t;return appended;
  }
  draw(transform){
    const gl=this.gl,canvas=this.canvas,dpr=Math.min(window.devicePixelRatio||1,2),
      w=Math.max(1,Math.round(canvas.clientWidth*dpr)),h=Math.max(1,Math.round(canvas.clientHeight*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    if(!this.length)return;
    gl.useProgram(this.program);gl.uniform2f(this.loc.origin,transform.origin[0]*dpr,transform.origin[1]*dpr);
    gl.uniform2f(this.loc.basisX,transform.basisX[0]*dpr,transform.basisX[1]*dpr);
    gl.uniform2f(this.loc.basisY,transform.basisY[0]*dpr,transform.basisY[1]*dpr);
    gl.uniform2f(this.loc.viewport,w,h);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    this.drawCalls=0;
    for(const g of this.groups){
      if(!g.objects)continue;
      gl.bindBuffer(gl.ARRAY_BUFFER,g.pos);gl.enableVertexAttribArray(this.loc.pos);gl.vertexAttribPointer(this.loc.pos,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,g.color);gl.enableVertexAttribArray(this.loc.color);gl.vertexAttribPointer(this.loc.color,4,gl.UNSIGNED_BYTE,true,0,0);
      const mode=[gl.POINTS,gl.LINES,gl.TRIANGLES][g.kind];
      const vertices=g.objects*g.vertexMultiplier,perBatch=60000-(60000%g.vertexMultiplier);
      for(let offset=0;offset<vertices;offset+=perBatch){gl.drawArrays(mode,offset,Math.min(perBatch,vertices-offset));this.drawCalls++;}
    }
    gl.disableVertexAttribArray(this.loc.pos);gl.disableVertexAttribArray(this.loc.color);
  }
  get pointObjects(){return this.groups[0].objects;}
  get lineObjects(){return this.groups[1].objects;}
  get polygonObjects(){return this.groups[2].objects;}
  destroy(){const g=this.gl;for(const group of this.groups){g.deleteBuffer(group.pos);g.deleteBuffer(group.color);}g.deleteProgram(this.program);}
}
