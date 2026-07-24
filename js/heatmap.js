
const $=s=>document.querySelector(s);
const ALLOWED_ZONES=['A','B','HV','HS'];
const state={data:null,zone:'GERAL',selected:null};

document.addEventListener('DOMContentLoaded',init);

async function init(){
  $('#refreshBtn').onclick=()=>load(true);
  $('#exportBtn').onclick=()=>print();
  $('#fullscreenBtn').onclick=toggleFullscreen;
  $('#zoneSelect').onchange=e=>{state.zone=e.target.value;state.selected=null;renderAll()};
  $('#searchInput').addEventListener('input',renderHeat);
  document.addEventListener('fullscreenchange',updateFullscreenButton);
  await load();
  setInterval(()=>load(true),WMS.config.REFRESH_MS||120000);
}

async function load(force=false){
  status('loading','Carregando');
  try{
    state.data=await WMS.load(force);
    const available=WMS.zones(state.data).filter(z=>ALLOWED_ZONES.includes(String(z).toUpperCase()));
    if(!available.length)throw new Error('Nenhuma das zonas A, B, HV ou HS foi encontrada.');

    const options=[
      '<option value="GERAL">Visão geral · Todas as zonas</option>',
      ...ALLOWED_ZONES.map(z=>{
        const exists=available.includes(z);
        return `<option value="${z}" ${exists?'':'disabled'}>Zona ${z}${exists?'':' · sem dados'}</option>`;
      })
    ];
    $('#zoneSelect').innerHTML=options.join('');
    if(state.zone!=='GERAL'&&!available.includes(state.zone))state.zone='GERAL';
    $('#zoneSelect').value=state.zone;

    renderAll();
    const src=WMS.getSourceInfo();
    status('ok',src.type==='excel'?'Excel manual carregado':(WMS.config.SHEET_API_URL?'Google Sheets conectado':'Modo local'));
    updateMainSourceBadge();
  }catch(e){
    console.error(e);
    status('error','Falha ao carregar');
    toast(e.message);
  }
}

function zoneRows(list){
  return list.filter(x=>ALLOWED_ZONES.includes(String(x.Zona).toUpperCase())&&(state.zone==='GERAL'||String(x.Zona)===state.zone));
}
function cells(){return zoneRows(state.data.cells)}
function roads(){return zoneRows(state.data.corridors)}

function aggregateGeneral(){
  const selected=state.data.zones.filter(z=>ALLOWED_ZONES.includes(String(z.Zona)));
  const o={Zona:'GERAL',total:0,ocupado:0,disponivel:0,bloqueado:0,qtd_pecas:0,volume_limit:0,volume_occupied:0};
  selected.forEach(z=>['total','ocupado','disponivel','bloqueado','qtd_pecas','volume_limit','volume_occupied'].forEach(k=>o[k]+=Number(z[k]||0)));
  o.volume_available=Math.max(0,o.volume_limit-o.volume_occupied);
  o.occ_pct=o.volume_limit>0?Math.round(o.volume_occupied/o.volume_limit*1000)/10:null;
  return o;
}

function currentSummary(){
  return state.zone==='GERAL'
    ?aggregateGeneral()
    :(state.data.zones.find(x=>String(x.Zona)===state.zone)||{});
}

function renderAll(){
  renderKpis();
  renderHeat();
  renderRanking();
  renderInsights();
  renderDetail();
}

function renderKpis(){
  const z=currentSummary();
  const a=[
    ['Ocupação volumétrica',pct(z.occ_pct),'volume ocupado ÷ limite'],
    ['Volume limite',fmtVolume(z.volume_limit),'capacidade total em cm³'],
    ['Volume ocupado',fmtVolume(z.volume_occupied),'volume utilizado'],
    ['Volume disponível',fmtVolume(z.volume_available),'capacidade restante'],
    ['Posições',WMS.fmt(z.total),'endereços considerados']
  ];
  $('#kpis').innerHTML=a.map(x=>`<div class="kpi card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('');
}

function renderHeat(){
  if(!state.data)return;

  const q=$('#searchInput').value.trim().toUpperCase();
  const parsed=parse(q);
  if(parsed.zone&&ALLOWED_ZONES.includes(parsed.zone)){
    state.zone=parsed.zone;
    $('#zoneSelect').value=parsed.zone;
  }

  const cs=cells();
  const levels=[...new Set(cs.map(x=>Number(x.nivel)))].sort((a,b)=>a-b);
  const allKeys=[...new Set(cs.map(x=>`${x.Zona}|${Number(x.rua_num)}`))]
    .map(k=>{const [zone,road]=k.split('|');return{zone,road:+road}})
    .sort((a,b)=>ALLOWED_ZONES.indexOf(a.zone)-ALLOWED_ZONES.indexOf(b.zone)||a.road-b.road);

  const filtered=allKeys.filter(item=>{
    if(parsed.road&&item.road!==parsed.road)return false;
    if(q&&/^\d+$/.test(q)&&!String(item.road).includes(q))return false;
    return true;
  });

  const cellMap=new Map(cs.map(c=>[`${c.Zona}|${+c.rua_num}|${+c.nivel}`,c]));
  const roadMap=new Map(roads().map(r=>[`${r.Zona}|${+r.rua_num}`,r]));

  const head=`<tr><th>${state.zone==='GERAL'?'Zona / Rua':'Rua'}</th>${levels.map(l=>`<th>N${pad(l)}</th>`).join('')}<th>Total rua</th></tr>`;

  const body=filtered.map(item=>{
    const {zone,road}=item;
    const roadData=roadMap.get(`${zone}|${road}`);
    const label=state.zone==='GERAL'?`Zona ${zone} · Rua ${pad(road)}`:`Rua ${pad(road)}`;

    const td=levels.map(level=>{
      const c=cellMap.get(`${zone}|${road}|${level}`);
      return c
        ?`<td class="heat-cell ${WMS.cls(c.occ_pct)}" data-z="${zone}" data-r="${road}" data-l="${level}">
            <strong>${pct(c.occ_pct)}</strong>
            <span>${fmtCompact(c.volume_occupied)} / ${fmtCompact(c.volume_limit)} cm³</span>
          </td>`
        :`<td class="heat-cell blocked"><strong>—</strong><span>sem dado</span></td>`;
    }).join('');

    const total=roadData
      ?`<td class="heat-cell ${WMS.cls(roadData.occ_pct)}" data-z="${zone}" data-r="${road}" data-l="0">
          <strong>${pct(roadData.occ_pct)}</strong>
          <span>${fmtCompact(roadData.volume_occupied)} / ${fmtCompact(roadData.volume_limit)} cm³</span>
        </td>`
      :'<td></td>';

    return`<tr><td>${label}</td>${td}${total}</tr>`;
  }).join('');

  $('#heatmap').innerHTML=filtered.length
    ?`<table class="heat-table">${head}${body}</table>`
    :'Nenhuma rua encontrada';

  document.querySelectorAll('[data-r]').forEach(e=>e.onclick=()=>select(e.dataset.z,+e.dataset.r,+e.dataset.l));
}

function renderRanking(){
  const a=roads().slice().sort((a,b)=>(b.occ_pct??-1)-(a.occ_pct??-1)).slice(0,10);
  $('#ranking').innerHTML=a.map((r,i)=>`
    <div class="rank-row">
      <div class="rank-num">${i+1}</div>
      <div>
        <strong>${state.zone==='GERAL'?`Zona ${r.Zona} · `:''}Rua ${pad(r.rua_num)}</strong>
        <div class="rank-bar"><i style="width:${Math.max(0,Math.min(100,+r.occ_pct||0))}%"></i></div>
      </div>
      <b>${pct(r.occ_pct)}</b>
    </div>`).join('');
}

function renderInsights(){
  const rs=roads().filter(r=>r.occ_pct!=null);
  const crit=rs.filter(r=>r.occ_pct>=90);
  const free=rs.slice().sort((a,b)=>(a.occ_pct??999)-(b.occ_pct??999))[0];
  const summary=currentSummary();
  const a=[
    crit.length?`${crit.length} rua(s) acima de 90% de ocupação volumétrica.`:'Nenhuma rua crítica acima de 90%.',
    free?`Maior folga: ${state.zone==='GERAL'?`Zona ${free.Zona} · `:''}Rua ${pad(free.rua_num)} com ${pct(free.occ_pct)}.`:'Sem dados para folga.',
    `${fmtVolume(summary.volume_available)} de volume disponível.`
  ];
  $('#insights').innerHTML=a.map(t=>`<div class="insight">${t}</div>`).join('');
}

function select(zone,road,level){
  state.selected=level
    ?cells().find(c=>String(c.Zona)===zone&&+c.rua_num===road&&+c.nivel===level)
    :roads().find(c=>String(c.Zona)===zone&&+c.rua_num===road);
  renderDetail();
}

function renderDetail(){
  const c=state.selected;
  if(!c){
    $('#detailGrid').className='detail-grid empty';
    $('#detailGrid').textContent='Nenhuma célula selecionada.';
    return;
  }

  $('#detailSubtitle').textContent=`Zona ${c.Zona} · Rua ${pad(c.rua_num)}${+c.nivel?` · Nível ${pad(c.nivel)}`:''}`;
  const a=[
    ['Zona',c.Zona],
    ['Rua',pad(c.rua_num)],
    ['Nível',+c.nivel?pad(c.nivel):'Consolidado'],
    ['Ocupação volumétrica',pct(c.occ_pct)],
    ['Volume limite',fmtVolume(c.volume_limit)],
    ['Volume ocupado',fmtVolume(c.volume_occupied)],
    ['Volume disponível',fmtVolume(c.volume_available)],
    ['Posições',WMS.fmt(c.total)],
    ['Bloqueadas',WMS.fmt(c.bloqueado)]
  ];
  $('#detailGrid').className='detail-grid';
  $('#detailGrid').innerHTML=a.map(x=>`<div class="metric"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join('')
    +`<div class="metric"><small>Ação</small><strong><a href="3d.html?zone=${c.Zona}&road=${c.rua_num}&level=${c.nivel||'all'}">Abrir no 3D →</a></strong></div>`;
}

async function toggleFullscreen(){
  const card=$('#heatCard');
  try{
    if(!document.fullscreenElement){
      if(card.requestFullscreen)await card.requestFullscreen();
      else card.classList.add('fullscreen-fallback');
    }else{
      await document.exitFullscreen();
    }
  }catch(e){
    card.classList.toggle('fullscreen-fallback');
  }
  updateFullscreenButton();
}

function updateFullscreenButton(){
  const active=!!document.fullscreenElement||$('#heatCard').classList.contains('fullscreen-fallback');
  $('#fullscreenBtn').textContent=active?'⤢ Sair da tela cheia':'⛶ Expandir';
}

function parse(q){
  const m=q.match(/(A|B|HV|HS)[-_\/](\d+)[-_\/](\d+)/);
  if(m)return{zone:m[1],road:+m[2],level:+m[3]};
  const r=q.match(/RUA\s*(\d+)/);
  return r?{road:+r[1]}:{};
}


function updateMainSourceBadge(){
  const el=$('#sourceBadge');
  if(!el)return;
  const source=WMS.getSourceInfo?.()||{};
  if(source.type==='excel'){
    el.textContent=`Excel manual${source.fileName?` · ${source.fileName}`:''}`;
    el.className='source-badge excel';
  }else if(source.type==='sheets'){
    el.textContent='Google Sheets';
    el.className='source-badge sheets';
  }else{
    el.textContent=source.label||'Arquivo local';
    el.className='source-badge';
  }
}

function pct(v){return v==null?'—':`${Number(v).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`}
function pad(v){return String(+v).padStart(2,'0')}
function status(c,t){$('#status').className=`status ${c}`;$('#status').innerHTML=`<i></i>${t}`}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),3500)}
function fmtVolume(v){return `${Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:0})} cm³`}
function fmtCompact(v){
  const n=Number(v||0);
  if(n>=1e9)return`${(n/1e9).toLocaleString('pt-BR',{maximumFractionDigits:1})} bi`;
  if(n>=1e6)return`${(n/1e6).toLocaleString('pt-BR',{maximumFractionDigits:1})} mi`;
  if(n>=1e3)return`${(n/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1})} mil`;
  return n.toLocaleString('pt-BR',{maximumFractionDigits:0});
}


// ===== Análise por rua =====
const roadExplorerState={
  zone:null,
  road:null,
  view:'grid',
  rawPositions:[]
};

document.addEventListener('DOMContentLoaded',()=>{
  $('#openRoadExplorerBtn')?.addEventListener('click',openRoadExplorer);
  $('#openRoadExplorerNav')?.addEventListener('click',openRoadExplorer);
  $('#closeRoadExplorerBtn')?.addEventListener('click',closeRoadExplorer);
  $('#roadZoneSelect')?.addEventListener('change',e=>{
    roadExplorerState.zone=e.target.value;
    populateRoadOptions();
    renderRoadExplorer();
  });
  $('#roadSelect')?.addEventListener('change',e=>{
    roadExplorerState.road=Number(e.target.value);
    renderRoadExplorer();
  });
  $('#roadSearchInput')?.addEventListener('input',renderRoadExplorer);
  $('#roadGridViewBtn')?.addEventListener('click',()=>{
    roadExplorerState.view='grid';
    renderRoadExplorer();
  });
  $('#roadTableViewBtn')?.addEventListener('click',()=>{
    roadExplorerState.view='table';
    renderRoadExplorer();
  });
});

function openRoadExplorer(){
  if(!state.data)return;
  const available=WMS.zones(state.data).filter(z=>ALLOWED_ZONES.includes(String(z).toUpperCase()));
  roadExplorerState.zone=state.zone==='GERAL'?(available[0]||'A'):state.zone;
  populateRoadZoneOptions();
  populateRoadOptions();
  renderRoadExplorer();

  const dialog=$('#roadExplorerDialog');
  if(typeof dialog.showModal==='function')dialog.showModal();
  else dialog.setAttribute('open','');
  document.body.classList.add('dialog-open');
}

function closeRoadExplorer(){
  const dialog=$('#roadExplorerDialog');
  if(dialog.open)dialog.close();
  else dialog.removeAttribute('open');
  document.body.classList.remove('dialog-open');
}

function populateRoadZoneOptions(){
  const available=WMS.zones(state.data).filter(z=>ALLOWED_ZONES.includes(String(z).toUpperCase()));
  $('#roadZoneSelect').innerHTML=available.map(z=>`<option value="${z}">Zona ${z}</option>`).join('');
  if(!available.includes(roadExplorerState.zone))roadExplorerState.zone=available[0];
  $('#roadZoneSelect').value=roadExplorerState.zone;
}

function populateRoadOptions(){
  const roadsForZone=state.data.corridors
    .filter(r=>String(r.Zona)===roadExplorerState.zone)
    .sort((a,b)=>Number(a.rua_num)-Number(b.rua_num));

  $('#roadSelect').innerHTML=roadsForZone.map(r=>`<option value="${r.rua_num}">Rua ${pad(r.rua_num)}</option>`).join('');
  if(!roadsForZone.some(r=>Number(r.rua_num)===Number(roadExplorerState.road))){
    roadExplorerState.road=roadsForZone.length?Number(roadsForZone[0].rua_num):null;
  }
  if(roadExplorerState.road!=null)$('#roadSelect').value=String(roadExplorerState.road);
}

function renderRoadExplorer(){
  if(!state.data||!roadExplorerState.zone||roadExplorerState.road==null)return;

  const corridor=state.data.corridors.find(r=>
    String(r.Zona)===roadExplorerState.zone &&
    Number(r.rua_num)===Number(roadExplorerState.road)
  );

  const cellsForRoad=state.data.cells.filter(c=>
    String(c.Zona)===roadExplorerState.zone &&
    Number(c.rua_num)===Number(roadExplorerState.road)
  ).sort((a,b)=>Number(a.nivel)-Number(b.nivel));

  const query=($('#roadSearchInput')?.value||'').trim().toLowerCase();
  const positions=buildSyntheticPositions(cellsForRoad).filter(p=>{
    if(!query)return true;
    return [
      p.positionId,
      `modulo ${p.module}`,
      `módulo ${p.module}`,
      `nivel ${p.level}`,
      `nível ${p.level}`,
      String(p.position)
    ].some(v=>String(v).toLowerCase().includes(query));
  });

  roadExplorerState.rawPositions=positions;

  const summary=[
    ['Ocupação da rua',pct(corridor?.occ_pct)],
    ['Volume ocupado',fmtVolume(corridor?.volume_occupied)],
    ['Volume limite',fmtVolume(corridor?.volume_limit)],
    ['Volume disponível',fmtVolume(corridor?.volume_available)],
    ['Posições',WMS.fmt(corridor?.total)]
  ];
  $('#roadSummaryCards').innerHTML=summary.map(([label,value])=>`
    <div class="road-summary-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>`).join('');

  $('#roadGridViewBtn').classList.toggle('active',roadExplorerState.view==='grid');
  $('#roadTableViewBtn').classList.toggle('active',roadExplorerState.view==='table');
  $('#roadPositionGrid').classList.toggle('hidden',roadExplorerState.view!=='grid');
  $('#roadPositionTable').classList.toggle('hidden',roadExplorerState.view!=='table');

  renderRoadGrid(positions);
  renderRoadTable(positions);
}

function buildSyntheticPositions(cellsForRoad){
  const exact=(state.data.positions||[])
    .filter(p=>
      String(p.Zona)===roadExplorerState.zone &&
      Number(p.rua_num)===Number(roadExplorerState.road)
    )
    .map(p=>({
      zone:p.Zona,
      road:Number(p.rua_num),
      level:Number(p.nivel),
      module:Number(p.modulo),
      position:Number(p.posicao),
      positionId:p.location_id,
      occupied:String(p.status)==='ocupado',
      status:p.status,
      occupancy:Number(p.occ_pct)||0,
      volumeLimit:Number(p.volume_limit)||0,
      volumeOccupied:Number(p.volume_occupied)||0
    }));

  if(exact.length)return exact;

  // Compatibilidade com dados antigos que ainda não possuem posições individuais.
  const result=[];
  cellsForRoad.forEach(cell=>{
    const total=Math.max(1,Number(cell.total)||1);
    const occupiedRatio=Math.min(1,Math.max(0,(Number(cell.occ_pct)||0)/100));
    const modules=Math.max(1,Math.ceil(total/56));

    for(let i=0;i<total;i++){
      const module=Math.floor(i/56)+1;
      const position=(i%56)+1;
      const occupied=i<Math.round(total*occupiedRatio);
      result.push({
        zone:cell.Zona,
        road:Number(cell.rua_num),
        level:Number(cell.nivel),
        module,
        position,
        positionId:`${cell.Zona}-${pad(cell.rua_num)}-${pad(module)}-${pad(cell.nivel)}-${String(position).padStart(3,'0')}`,
        occupied,
        status:occupied?'ocupado':'disponivel',
        occupancy:Number(cell.occ_pct)||0,
        volumeLimit:Number(cell.volume_limit||0)/total,
        volumeOccupied:Number(cell.volume_occupied||0)/total
      });
    }
  });
  return result;
}

function renderRoadGrid(positions){
  if(!positions.length){
    $('#roadPositionGrid').innerHTML='<div class="road-empty">Nenhuma posição encontrada.</div>';
    return;
  }

  const grouped=new Map();
  positions.forEach(p=>{
    const key=`N${pad(p.level)} · M${pad(p.module)}`;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(p);
  });

  $('#roadPositionGrid').innerHTML=[...grouped.entries()].map(([group,items])=>`
    <section class="position-group">
      <div class="position-group-header">
        <strong>${group}</strong>
        <span>${items.length} posições</span>
      </div>
      <div class="position-cards">
        ${items.map(p=>`
          <button class="position-card ${p.status==='bloqueado'?'blocked':WMS.cls(p.occupancy)}" title="${p.positionId}">
            <strong>${String(p.position).padStart(3,'0')}</strong>
            <span>${p.occupancy.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</span>
          </button>`).join('')}
      </div>
    </section>`).join('');
}

function renderRoadTable(positions){
  if(!positions.length){
    $('#roadPositionTable').innerHTML='<div class="road-empty">Nenhuma posição encontrada.</div>';
    return;
  }

  $('#roadPositionTable').innerHTML=`
    <table>
      <thead>
        <tr>
          <th>Posição</th>
          <th>Nível</th>
          <th>Módulo</th>
          <th>Ocupação</th>
          <th>Volume ocupado</th>
          <th>Volume limite</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${positions.map(p=>`
          <tr>
            <td><strong>${p.positionId}</strong></td>
            <td>N${pad(p.level)}</td>
            <td>M${pad(p.module)}</td>
            <td>${pct(p.occupancy)}</td>
            <td>${fmtVolume(p.volumeOccupied)}</td>
            <td>${fmtVolume(p.volumeLimit)}</td>
            <td><span class="table-status ${p.status==='bloqueado'?'blocked':WMS.cls(p.occupancy)}">${p.status==='bloqueado'?'Bloqueada':(p.occupied?'Ocupada':'Disponível')}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

window.updateMainSourceBadge=updateMainSourceBadge;
