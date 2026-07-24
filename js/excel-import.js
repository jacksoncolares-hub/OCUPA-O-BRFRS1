
window.ExcelImport=(()=>{
  const aliases={
    location:['location id','location','endereco','endereço','posicao','posição','storage location','bin location'],
    zone:['zona','zone','area','área'],
    status:['status end','status','location status','situacao','situação','estado','status da posicao','status da posição'],
    pieces:['qtd pecas','qtd peças','quantidade pecas','quantidade peças','qty','quantity','pieces','unit qty','sku qty','quantidade','unidades'],
    road:['pathway id','rua2','rua','corredor','aisle','pathway'],
    pieceLimit:[
      'limite peças p/arm',
      'limite pecas p/arm',
      'limite peças p arm',
      'limite pecas p arm',
      'limite peças',
      'limite pecas',
      'capacidade peças',
      'capacidade pecas'
    ],
    realPieces:[
      'qtds peças real',
      'qtds pecas real',
      'qtd peças real',
      'qtd pecas real',
      'quantidade peças real',
      'quantidade pecas real',
      'peças real',
      'pecas real'
    ]
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
      pieceLimit:findHeader(h,aliases.pieceLimit),
      realPieces:findHeader(h,aliases.realPieces)
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
  function increment(target,key,zone,road,level,st,pieces,pieceLimit,realPieces){
    if(!target[key])target[key]={
      Zona:zone,rua_num:+road||0,nivel:+level||0,
      total:0,usable_positions:0,ocupado:0,disponivel:0,bloqueado:0,qtd_pecas:0,
      piece_limit:0,real_pieces:0
    };

    target[key].total++;
    target[key][st]++;

    // Posições bloqueadas ficam fora da capacidade disponível
    // e também fora do cálculo de ocupação.
    if(st!=='bloqueado'){
      target[key].usable_positions++;
      target[key].qtd_pecas+=Number(pieces||0);
      target[key].piece_limit+=Math.max(0,Number(pieceLimit||0));
      target[key].real_pieces+=Math.max(0,Number(realPieces||0));
    }
  }

  function final(o){
    const limit=Number(o.piece_limit||0);
    const real=Number(o.real_pieces||0);

    return{
      Zona:o.Zona,
      rua_num:+o.rua_num||0,
      nivel:+o.nivel||0,
      total:+o.total||0,
      usable_positions:+o.usable_positions||0,
      ocupado:+o.ocupado||0,
      disponivel:+o.disponivel||0,
      bloqueado:+o.bloqueado||0,
      occ_pct:limit>0?Math.round((real/limit)*1000)/10:null,
      qtd_pecas:Math.round((+o.qtd_pecas||0)*100)/100,
      piece_limit:Math.round(limit*100)/100,
      real_pieces:Math.round(real*100)/100,
      available_pieces:Math.round(Math.max(0,limit-real)*100)/100
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
    if(map.pieceLimit<0||map.realPieces<0){
      throw new Error('Não encontrei as colunas "Limite Peças p/Arm" e "Qtds Peças Real".');
    }

    const zoneAgg={},roadAgg={},cellAgg={},metaCalc={};
    const positions=[];
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
      const pieceLimit=num(row[map.pieceLimit]);
      const realPieces=num(row[map.realPieces]);

      const st=state(map.status>=0?row[map.status]:'',realPieces);
      increment(zoneAgg,zone,zone,road,level,st,pieces,pieceLimit,realPieces);
      increment(roadAgg,`${zone}|${road}`,zone,road,level,st,pieces,pieceLimit,realPieces);
      increment(cellAgg,`${zone}|${road}|${level}`,zone,road,level,st,pieces,pieceLimit,realPieces);

      const locParts=loc.toUpperCase().split('-');
      const moduleNumber=locParts.length>=6?parseInt(locParts[3],10):0;
      const positionNumber=locParts.length>=6?parseInt(locParts[5],10):0;

      positions.push({
        Zona:zone,
        rua_num:road,
        nivel:level,
        modulo:Number.isFinite(moduleNumber)?moduleNumber:0,
        posicao:Number.isFinite(positionNumber)?positionNumber:0,
        location_id:loc,
        status:st,
        qtd_pecas:pieces,
        piece_limit:st==='bloqueado'?0:pieceLimit,
        real_pieces:st==='bloqueado'?0:realPieces,
        blocked_piece_limit:st==='bloqueado'?pieceLimit:0,
        blocked_real_pieces:st==='bloqueado'?realPieces:0,
        available_pieces:st==='bloqueado'?0:Math.max(0,pieceLimit-realPieces),
        occ_pct:st==='bloqueado'?null:(pieceLimit>0?Math.round((realPieces/pieceLimit)*1000)/10:null)
      });
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
    const overall={Zona:'GERAL',rua_num:0,nivel:0,total:0,usable_positions:0,ocupado:0,disponivel:0,bloqueado:0,qtd_pecas:0,piece_limit:0,real_pieces:0};
    zones.forEach(z=>['total','usable_positions','ocupado','disponivel','bloqueado','qtd_pecas','piece_limit','real_pieces'].forEach(k=>overall[k]+=Number(z[k]||0)));
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
      overall:final(overall),zones,corridors,cells,positions,stock_trend:[],meta,
      assumptions:[
        'Ocupação = soma de Qtds Peças Real ÷ soma de Limite Peças p/Arm.',
        'Posições bloqueadas são excluídas da capacidade, das peças reais e do percentual de ocupação.',
        'Capacidade disponível considera somente posições não bloqueadas.',
        'Somente as zonas A, B, HV e HS são consideradas.'
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
