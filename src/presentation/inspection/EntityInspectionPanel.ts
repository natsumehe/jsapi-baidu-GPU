import type { AGVTrackRecord } from "../../data/runtime/AGVFleetRuntime";
/** Device dictionaries follow the uploaded 4.1.2 equipment-record description.
 * This project ships simulated states, NOT the source TSC/TAA/TAC CSV records.
 */
export type EntityKind='AGV'|'QC'|'ASC'|'CONTAINER';
export interface InspectionField {key:string;label:string;value:string|number;source?:'simulation'|'GIS'|'dictionary'}
export class EntityInspectionPanel {
  private root:HTMLElement;
  private title:HTMLElement;
  private subtitle:HTMLElement;
  private rows:HTMLElement;
  private trackRoot:HTMLElement;
  private previousEntity='';
  private trackLatestSample=-1;
  private rowsVisible=500;
  constructor(){
    const el=document.createElement('aside');el.id='entity-inspection';el.className='entity-inspection';
    el.setAttribute('aria-label','设备及集装箱信息');el.hidden=true;
    const head=document.createElement('div');head.className='entity-inspection-head';
    const heading=document.createElement('div');this.title=document.createElement('strong');this.subtitle=document.createElement('small');heading.append(this.title,this.subtitle);
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭信息面板');close.onclick=()=>{el.hidden=true;};
    head.append(heading,close);
    const note=document.createElement('p');note.textContent='数据源：GIS 位置 + 模拟作业状态。TSC / TAA / TAC 字段参考上传的数据说明；未提供真实 CSV，不代表真实设备遥测。';note.className='entity-inspection-note';
    this.rows=document.createElement('dl');this.rows.className='entity-inspection-rows';
    this.trackRoot=document.createElement('section');this.trackRoot.className='agv-history';this.trackRoot.hidden=true;
    el.append(head,note,this.rows,this.trackRoot);document.body.append(el);this.root=el;
  }
  show(kind:EntityKind,id:string,fields:InspectionField[]):void {
    const labels:Record<EntityKind,string>={AGV:'自动导引运输车',QC:'岸桥起重机',ASC:'堆场轨道吊',CONTAINER:'标准集装箱'};
    const entity=`${kind}:${id}`;
    if(entity!==this.previousEntity){this.trackRoot.hidden=true;this.trackRoot.replaceChildren();this.trackLatestSample=-1;}
    this.previousEntity=entity;
    this.title.textContent=`${labels[kind]} · ${id}`;this.subtitle.textContent=`${kind} · 点击地图其他对象可切换`;this.rows.replaceChildren();
    const frag=document.createDocumentFragment();
    for(const item of fields){const term=document.createElement('dt'),value=document.createElement('dd');
      term.textContent=item.key?`${item.label} · ${item.key}`:item.label;value.textContent=String(item.value);
      if(item.source){const tag=document.createElement('em');tag.textContent=item.source==='GIS'?'GIS':'模拟';value.append(' ',tag);}
      frag.append(term,value);
    }this.rows.append(frag);this.root.hidden=false;
  }
  showTrack(records:AGVTrackRecord[]):void {
    const section=this.trackRoot;
    const latest=records.at(-1)?.sample??-1;
    // Keep updating live metrics every 750 ms, but rebuild the long history
    // table only every 10 new samples (~2.5 simulated s) to protect FPS.
    if(!section.hidden && latest>=this.trackLatestSample && latest-this.trackLatestSample<10)return;
    this.trackLatestSample=latest;section.replaceChildren();section.hidden=false;
    const head=document.createElement('div');head.className='agv-history-head';
    const title=document.createElement('strong');title.textContent=`模拟历史轨迹 · ${records.length} 条可导出，当前显示最近 ${Math.min(records.length,this.rowsVisible)} 条`;
    const countPicker=document.createElement('select');countPicker.setAttribute('aria-label','历史轨迹表显示条数');
    for(const n of [200,500,1000,3600]){const option=document.createElement('option');option.value=String(n);option.textContent=`显示 ${n} 条`;countPicker.append(option);}
    countPicker.value=String(this.rowsVisible);
    countPicker.onchange=()=>{this.rowsVisible=Number(countPicker.value);this.trackLatestSample=-1;this.showTrack(records);};
    const exportButton=document.createElement('button');exportButton.textContent='导出 CSV';exportButton.type='button';
    exportButton.onclick=()=>{
      const columns=['sample','simulatedSeconds','x','y','speedMps','heading','phase','taskId','source'] as const;
      const escape=(value:string|number)=>`"${String(value).replaceAll('"','""')}"`;
      const csv=[columns.join(','),...records.map(r=>columns.map(c=>escape(r[c])).join(','))].join('\r\n');
      const file=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(file);
      const anchor=document.createElement('a');anchor.href=url;anchor.download='agv-simulation-history.csv';anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),500);
    };
    head.append(title,countPicker,exportButton);
    const note=document.createElement('p');note.textContent=`历史模拟 ${records.filter(r=>r.source==='synthetic-history').length} 条；本次实际模拟运行 ${records.filter(r=>r.source==='live-simulation').length} 条。都不是实际港口 GPS 或 TOS 记录。`;
    const table=document.createElement('table');table.className='agv-history-table';
    const caption=document.createElement('thead');caption.innerHTML='<tr><th>序号</th><th>模拟秒</th><th>阶段</th><th>速度 km/h</th><th>坐标 X/Y (m)</th></tr>';
    const body=document.createElement('tbody');
    for(const r of [...records].slice(-this.rowsVisible).reverse()){
      const row=document.createElement('tr');
      for(const value of [r.sample,r.simulatedSeconds.toFixed(1),r.phase,(r.speedMps*3.6).toFixed(1),`${r.x.toFixed(1)}, ${r.y.toFixed(1)}`]){
        const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);
      }body.append(row);
    }
    table.append(caption,body);section.append(head,note,table);
  }
  hide():void{this.root.hidden=true;}
  destroy():void{this.root.remove();}
}
