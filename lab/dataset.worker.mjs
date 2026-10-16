import { generateChunk } from './dataset.mjs';
self.onmessage=event=>{
  const {requestId,start,count,seed,profile,geometry}=event.data;
  try {
    const generated=generateChunk(start,count,seed,profile,geometry);
    self.postMessage({requestId,...generated},[generated.positions.buffer,generated.colors.buffer,generated.types.buffer]);
  } catch(e) {self.postMessage({requestId,error:String(e)});}
};
