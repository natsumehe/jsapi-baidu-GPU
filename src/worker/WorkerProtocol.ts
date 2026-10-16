export type WorkerRequest =
 | {type:"decode-tile";id:number;tileId:string;buffer:ArrayBuffer}
 | {type:"stream-start";id:number;tileId:string}
 | {type:"stream-chunk";id:number;chunk:ArrayBuffer}
 | {type:"stream-finish";id:number}
 | {type:"stream-cancel";id:number};
export type WorkerResponse =
 | {type:"stream-ready";id:number}
 | {type:"chunk-ack";id:number}
 | {type:"decoded-chunk";id:number;tileId:string;offset:number;count:number;positions:ArrayBuffer;colors:ArrayBuffer}
 | {type:"decoded";id:number;tileId:string;count:number;positions:ArrayBuffer;colors:ArrayBuffer}
 | {type:"error";id:number;error:string};
