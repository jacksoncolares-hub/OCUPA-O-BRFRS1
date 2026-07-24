
window.ExcelImport=(()=>{
  const aliases={
    location:['location id','location','endereco','endereço','posicao','posição','storage location','bin location'],
    zone:['zona','zone','area','área'],
    status:['status end','status','location status','situacao','situação','estado','status da posicao','status da posição'],
    pieces:['qtd pecas','qtd peças','quantidade pecas','quantidade peças','qty','quantity','pieces','unit qty','sku qty','quantidade','unidades'],
    road:['pathway id','rua2','rua','corredor','aisle','pathway'],
    volumeLimit:['volume limit(cm3)','volume limit','limite volume','capacidade volume','volume total'],
    volumeOccupied:['volume occupied','volume ocupado','volume utilizado','occupied volume']
  };
  const ALLOWED_ZONES=['A','B','HV','HS'];

  function clean(v){
    return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[_\-]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  }
  function findHeader(headers,candidates){
    for(const c of candidates){const i=headers.indexOf(clean(c));if(i>=0)return i}
    for(const c of candidates){const cc=clean(c),i=headers.findIndex(h=>h.includes(cc));if(i>=0)return i}
    return -1;
  }
  function mapColumns(rawHeaders){
    const h=rawHeaders.map(clean);
    return{
      location:findHeader(h,aliases.location),
      zone:findHeader(h,aliases.zone),
      status:findHeader(h,aliases.status),
      pieces:findHeader(h,aliases.pieces),
      road:findHeader(h,aliases.road),
      volumeLimit:findHeader(h,aliases.volumeLimit),
      volumeOccupied:findHeader(h,aliases.volumeOccupied)
    };
  }
  function parseLocation(locationId,zoneCell,roadCell){
    const raw=String(locationId||'').trim().toUpperCase();
    if(!raw)return null;

    const parts=raw
      .replace(/[\/\\|_]+/g,'-')
      .split('-')
      .map(x=>x.trim())
      .filter(Boolean);

    let zone=String(zoneCell||'').trim().toUpperCase();
    let road=parseInt(String(roadCell??'').replace(/\D/g,''),10);
    let level=null;

    /*
      Formato real da planilha BRFRS1:
      BRFRS1-A-23-05-3-018
             │  │  │  │
             │  │  │  └ posição
             │  │  └ nível
             │  └ módulo/bay
             └ rua/pathway

      Portanto:
      zona = bloco após BRFRS1
      rua  = primeiro bloco após a zona
      nível = terceiro bloco após a zona
    */
    const zoneIndex=parts.findIndex((part,index)=>
      index>0 &&
      /^[A-Z][A-Z0-9]{0,3}$/.test(part) &&
      parts.length>index+4
    );

    if(zoneIndex>=0){
      if(!zone)zone=parts[zoneIndex];
      if(!Number.isFinite(road))road=parseInt(parts[zoneIndex+1],10);
      level=parseInt(parts[zoneIndex+3],10);
    }

    // Fallback para formatos curtos, como A-23-05-3-018.
    if((!zone||!Number.isFinite(road)||!Number.isFinite(level))&&parts.length>=5){
      const start=parts.length-5;
      if(!zone)zone=parts[start];
      if(!Number.isFinite(road))road=parseInt(parts[start+1],10);
      level=parseInt(parts[start+3],10);
    }

    zone=String(zone||'').replace(/[^A-Z0-9]/g,'');

    return zone&&Number.isFinite(road)&&Number.isFinite(level)
      ?{zone,road,level}
      :null;
  }
  function num(v){
    if(typeof v==='number')return Number.isFinite(v)?v:0;
    let t=String(v??'').trim().replace(/\s/g,'');if(!t)return 0;
    if(t.includes(','))t=t.replace(/\./g,'').replace(',','.');else t=t.replace(/,/g,'');
    t=t.replace(/[^\d.\-]/g,'');const n=Number(t);return Number.isFinite(n)?n:0;
  }
  function state(statusValue,pieces){
    const s=clean(statusValue);
    if(s.includes('bloq')||s.includes('block')||s.includes('disable')||s.includes('inativo'))return'bloqueado';
    if(s.includes('ocup')||s.includes('occupied')||s.includes('full')||s.includes('used'))return'ocupado';
    if(s.includes('disp')||s.includes('avail')||s.includes('empty')||s.includes('livre')||s.includes('vazio'))return'disponivel';
    return Number(pieces||0)>0?'ocupado':'disponivel';
  }
  function increment(target,key,zone,road,level,st,pieces,volumeLimit,volumeOccupied){
    if(!target[key])target[key]={
      Zona:zone,rua_num:+road||0,nivel:+level||0,
      total:0,ocupado:0,disponivel:0,bloqueado:0,qtd_pecas:0,
      volume_limit:0,volume_occupied:0
    };
    target[key].total++;
    target[key][st]++;
    target[key].qtd_pecas+=Number(pieces||0);
    target[key].volume_limit+=Math.max(0,Number(volumeLimit||0));
    target[key].volume_occupied+=Math.max(0,Number(volumeOccupied||0));
  }
  function final(o){
    const limit=Number(o.volume_limit||0);
    const occupied=Number(o.volume_occupied||0);
    return{
      Zona:o.Zona,
      rua_num:+o.rua_num||0,
      nivel:+o.nivel||0,
      total:+o.total||0,
      ocupado:+o.ocupado||0,
      disponivel:+o.disponivel||0,
      bloqueado:+o.bloqueado||0,
      occ_pct:limit>0?Math.round((occupied/limit)*1000)/10:null,
      qtd_pecas:Math.round((+o.qtd_pecas||0)*100)/100,
      volume_limit:Math.round(limit*100)/100,
      volume_occupied:Math.round(occupied*100)/100,
      volume_available:Math.round(Math.max(0,limit-occupied)*100)/100
    };
  }
  function zoneSort(a,b){
    const order={A:1,B:2,HV:3,HS:4},za=typeof a==='string'?a:a.Zona,zb=typeof b==='string'?b:b.Zona;
    return(order[za]||99)-(order[zb]||99)||String(za).localeCompare(String(zb));
  }
  function aggregate(rows,sheetName,fileName,onProgress){
    if(!rows?.length)throw new Error('A aba selecionada está vazia.');
    const headers=rows[0].map(v=>String(v??''));
    const map=mapColumns(headers);
    if(map.location<0)throw new Error('Não encontrei a coluna de localização. Cabeçalhos: '+headers.join(' | '));
    if(map.volumeLimit<0||map.volumeOccupied<0){
      throw new Error('Não encontrei as colunas "Volume limit(cm3)" e "Volume occupied".');
    }

    const zoneAgg={},roadAgg={},cellAgg={},metaCalc={};
    let valid=0,ignored=0;
    const total=Math.max(1,rows.length-1);

    for(let i=1;i<rows.length;i++){
      const row=rows[i]||[];
      if(!row.some(v=>String(v??'').trim()!==''))continue;
      const loc=String(row[map.location]??'').trim();
      const parsed=parseLocation(
        loc,
        map.zone>=0?row[map.zone]:'',
        map.road>=0?row[map.road]:''
      );
      if(!parsed){ignored++;continue}
      const {zone,road,level}=parsed;
      if(!ALLOWED_ZONES.includes(zone)){ignored++;continue}
      const pieces=map.pieces>=0?num(row[map.pieces]):0;
      const volumeLimit=num(row[map.volumeLimit]);
      const volumeOccupied=num(row[map.volumeOccupied]);
      const st=state(map.status>=0?row[map.status]:'',pieces);
      increment(zoneAgg,zone,zone,road,level,st,pieces,volumeLimit,volumeOccupied);
      increment(roadAgg,`${zone}|${road}`,zone,road,level,st,pieces,volumeLimit,volumeOccupied);
      increment(cellAgg,`${zone}|${road}|${level}`,zone,road,level,st,pieces,volumeLimit,volumeOccupied);
      if(!metaCalc[zone])metaCalc[zone]={roads:{},levels:{},roadMin:road,roadMax:road};
      metaCalc[zone].roads[road]=true;metaCalc[zone].levels[level]=true;
      metaCalc[zone].roadMin=Math.min(metaCalc[zone].roadMin,road);
      metaCalc[zone].roadMax=Math.max(metaCalc[zone].roadMax,road);
      valid++;
      if(onProgress&&i%2000===0)onProgress(Math.round(i/total*90));
    }

    const zones=Object.keys(zoneAgg).sort(zoneSort).map(k=>final(zoneAgg[k]));
    const corridors=Object.keys(roadAgg).map(k=>final(roadAgg[k])).sort((a,b)=>zoneSort(a,b)||a.rua_num-b.rua_num);
    const cells=Object.keys(cellAgg).map(k=>final(cellAgg[k])).sort((a,b)=>zoneSort(a,b)||a.rua_num-b.rua_num||a.nivel-b.nivel);
    const overall={Zona:'GERAL',rua_num:0,nivel:0,total:0,ocupado:0,disponivel:0,bloqueado:0,qtd_pecas:0,volume_limit:0,volume_occupied:0};
    zones.forEach(z=>['total','ocupado','disponivel','bloqueado','qtd_pecas','volume_limit','volume_occupied'].forEach(k=>overall[k]+=Number(z[k]||0)));
    const meta={};
    const presets={
      A:{label:'Zona A',tipo:'bin'},
      B:{label:'Zona B',tipo:'pallet'},
      HV:{label:'Zona HV',tipo:'bin'},
      HS:{label:'Zona HS',tipo:'bin'}
    };
    Object.keys(metaCalc).forEach(z=>{
      const m=metaCalc[z],p=presets[z]||{};
      meta[z]={label:p.label||`Zona ${z}`,tipo:p.tipo||'bin',ruas:Object.keys(m.roads).length,
        niveis:Math.max(...Object.keys(m.levels).map(Number)),rua_min:m.roadMin,rua_max:m.roadMax};
    });
    onProgress?.(100);
    return{ok:true,generated_at:new Date().toLocaleString('pt-BR'),source:{type:'manual_excel',file_name:fileName,sheet_name:sheetName,valid_rows:valid,ignored_rows:ignored},
      overall:final(overall),zones,corridors,cells,stock_trend:[],meta,
      assumptions:[
        'Ocupação = soma de Volume occupied ÷ soma de Volume limit(cm3).',
        'Somente as zonas A, B, HV e HS são consideradas.',
        'Dados importados localmente do Excel.'
      ]};
  }

  async function read(file,{sheetName,onProgress}={}){
    if(!window.XLSX)throw new Error('Biblioteca de Excel não carregada. Verifique a internet e tente novamente.');
    const ext=file.name.split('.').pop().toLowerCase();
    if(!['xlsx','xls','xlsm','csv'].includes(ext))throw new Error('Formato não suportado. Use .xlsx, .xls, .xlsm ou .csv.');
    onProgress?.(5,'Lendo arquivo');
    const buffer=await file.arrayBuffer();
    onProgress?.(18,'Abrindo planilha');
    const wb=XLSX.read(buffer,{type:'array',cellDates:false,dense:true});
    const chosen=sheetName&&wb.SheetNames.includes(sheetName)?sheetName:findBestSheet(wb);
    const ws=wb.Sheets[chosen];
    onProgress?.(25,`Processando aba ${chosen}`);
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});
    const data=aggregate(rows,chosen,file.name,p=>onProgress?.(25+Math.round(p*.7),'Consolidando posições'));
    return{data,sheetNames:wb.SheetNames,selectedSheet:chosen};
  }
  function findBestSheet(wb){
    let best=wb.SheetNames[0],score=-1;
    for(const name of wb.SheetNames){
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:'',range:0});
      if(!rows.length)continue;
      const map=mapColumns(rows[0]||[]);
      const s=(map.location>=0?100000:0)+rows.length;
      if(s>score){score=s;best=name}
    }
    return best;
  }
  return{read};
})();
