import {performance} from 'node:perf_hooks';
import {mergeEventChunk as baseline} from '../../artifacts/performance/baseline-source/src/event-stream.mjs';
import {mergeEventChunk as current} from '../../src/event-stream.mjs';
const existing=Array.from({length:6000},(_,i)=>{const start=new Date(Date.UTC(2026,0,1+i%365,9));return{id:String(i),calendarId:'c',title:`Event ${i}`,description:'Synthetic',location:'Room',start:start.toISOString(),end:new Date(+start+3600000).toISOString(),allDay:false,tags:['school'],source:'google',readOnly:false,etag:'version1'};});
const from=new Date('2026-10-01'),to=new Date('2026-10-15');
const incoming=existing.filter(e=>new Date(e.start)>=from&&new Date(e.start)<to).map(e=>({...e,tags:[...e.tags]}));
const results=[];
for(const[name,merge]of[['baseline',baseline],['current',current]]){
 for(let i=0;i<5;i++)merge(existing,incoming,from,to,['c']);
 const samples=[];for(let i=0;i<25;i++){const start=performance.now();merge(existing,incoming,from,to,['c']);samples.push(performance.now()-start);}
 samples.sort((a,b)=>a-b);results.push({name,events:existing.length,incoming:incoming.length,medianMs:samples[12],samples});
}
console.log(JSON.stringify(results,null,2));
