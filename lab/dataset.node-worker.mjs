import {parentPort} from 'node:worker_threads';
import {generateChunk} from './dataset.mjs';
parentPort.on('message',({start,count,seed,profile,geometry})=>{
 const data=generateChunk(start,count,seed,profile,geometry);
 parentPort.postMessage(data,[data.positions.buffer,data.colors.buffer,data.types.buffer]);
});
