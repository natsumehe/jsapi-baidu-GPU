/** Export the SAME production AGV runtime to the dependency-free preview. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
let ts;
try{ts=require('typescript');}catch{ts=require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'));}
const source=fs.readFileSync('src/data/runtime/AGVFleetRuntime.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
if(!js.includes('export class AGVFleetRuntime'))throw Error('Unexpected runtime source structure');
fs.writeFileSync('public/preview/AGVFleetRuntime.mjs','// AUTO-GENERATED from src/data/runtime/AGVFleetRuntime.ts. Do not edit.\n'+js,'utf8');
console.log('Preview AGV runtime updated.');
