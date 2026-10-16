import test from 'node:test';
import assert from 'node:assert/strict';
import {generateChunk,pointFor,cpuCull,compactChunk,percentile} from '../lab/dataset.mjs';
test('same seed & ID yields same coordinate across arbitrary partitioning',()=>{
 const whole=generateChunk(0,1453,771);
 const first=generateChunk(0,500,771),second=generateChunk(500,953,771);
 assert.deepEqual([...whole.positions],[...first.positions,...second.positions]);
 assert.deepEqual([...whole.colors],[...first.colors,...second.colors]);
 assert.deepEqual([...whole.types],[...first.types,...second.types]);
});
test('different seeds produce different spatial layouts',()=>{
 assert.notDeepEqual(pointFor(99,9),pointFor(99,10));
});
test('cull count and compaction preserve source order and colour',()=>{
 const src=generateChunk(11,10000,42);const b={minX:-400,maxX:200,minY:-500,maxY:100};
 const {flags,visible}=cpuCull(src,b),filtered=compactChunk(src,flags);
 assert.equal(filtered.count,visible);assert.equal(filtered.positions.length,visible*2);assert.equal(filtered.colors.length,visible*4);
 let j=0;
 for(let i=0;i<src.count;i++)if(flags[i]){
  assert.equal(filtered.positions[j*2],src.positions[i*2]);
  assert.deepEqual([...filtered.colors.slice(j*4,j*4+4)],[...src.colors.slice(i*4,i*4+4)]);j++;
 }
 assert.equal(j,visible);
});
test('percentile is stable for zero, one and multiple frames',()=>{
 assert.equal(percentile([],.95),null);assert.equal(percentile([9],.95),9);
 assert.equal(percentile([30,10,20,40,50],.95),50);
});
test('invalid sizes fail without huge allocations',()=>{
 assert.throws(()=>generateChunk(-1,10));assert.throws(()=>generateChunk(0,1000001));
});
