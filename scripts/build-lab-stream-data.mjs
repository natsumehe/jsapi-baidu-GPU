/** Generates the deterministic 1M-object HTTP stream reference file.
 * This is a static network asset, not an in-browser generator posing as fetch. */
import fs from 'node:fs';
import path from 'node:path';
import {generateChunk,DEFAULT_SEED} from '../lab/dataset.mjs';
const dir=path.resolve('public/data/lab');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'abstract_mixed_1m.ysl');
const f=fs.openSync(file,'w');
try{
  const header=Buffer.alloc(12);header.write('YSL1');header.writeUInt32LE(1_000_000,4);header.writeUInt32LE(DEFAULT_SEED,8);fs.writeSync(f,header);
  for(let start=0;start<1_000_000;start+=8192){
    const chunk=generateChunk(start,Math.min(8192,1_000_000-start),DEFAULT_SEED,'uniform','mixed');
    const bytes=Buffer.allocUnsafe(chunk.count*9);
    for(let j=0;j<chunk.count;j++){
      bytes.writeFloatLE(chunk.positions[j*2],j*9);
      bytes.writeFloatLE(chunk.positions[j*2+1],j*9+4);
      bytes[j*9+8]=chunk.types[j];
    }fs.writeSync(f,bytes);
  }
}finally{fs.closeSync(f);}
console.log('Wrote',file,fs.statSync(file).size,'bytes');
