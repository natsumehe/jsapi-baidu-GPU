/** Node HTTP streaming transport check only; never claim browser WebGL FPS. */
import http from 'node:http';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {SpatialRecordDecoder} from '../lab/stream-codec.mjs';
const filename='public/data/lab/abstract_mixed_1m.ysl';
const server=http.createServer((_req,res)=>{
 res.writeHead(200,{'content-type':'application/octet-stream','cache-control':'no-store'});
 fs.createReadStream(filename,{highWaterMark:16*1024}).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const started=performance.now();let firstChunk=null,reads=0,bytes=0,objects=0,batches=0;
try{
 const resp=await fetch(`http://127.0.0.1:${server.address().port}/test.ysl`);
 if(!resp.ok||!resp.body)throw Error('HTTP body unavailable');
 const reader=resp.body.getReader(),decoder=new SpatialRecordDecoder(4096);
 for(;;){const {done,value}=await reader.read();if(done)break;reads++;bytes+=value.byteLength;
  for(const c of decoder.push(value)){objects+=c.count;batches++;if(firstChunk===null)firstChunk=performance.now()-started;}
 }
 decoder.finish();
 if(objects!==1000000)throw Error('Incorrect streamed count '+objects);
 console.log(JSON.stringify({measurement:'Node HTTP transport + binary decode; no GPU',reads,bytes,objects,batches,
  firstBatchMs:Number(firstChunk.toFixed(2)),totalMs:Number((performance.now()-started).toFixed(2))},null,2));
}finally{server.close();}
