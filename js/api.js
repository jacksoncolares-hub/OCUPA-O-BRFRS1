
window.WMS=(()=>{
  let cache=null;
  let sourceInfo={type:'none',label:'Nenhuma fonte',updatedAt:null,fileName:null};
  const c=window.APP_CONFIG||{};
  const DB_NAME='BRFRS1_OCCUPANCY_DB',STORE='datasets',KEY='manual_excel';

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  async function dbGet(){
    try{
      const db=await openDb();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(KEY);
        req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
      });
    }catch(e){console.warn('IndexedDB indisponível',e);return null}
  }
  async function dbSet(value){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(value,KEY);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    });
  }
  async function dbDelete(){
    try{
      const db=await openDb();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      });
    }catch(e){}
  }

  function normalize(d){
    if(d.ok===false)throw new Error(d.error||'Erro da API');
    d.zones=Array.isArray(d.zones)?d.zones:[];
    d.corridors=Array.isArray(d.corridors)?d.corridors:[];
    d.cells=Array.isArray(d.cells)?d.cells:[];
    d.meta=d.meta||{};d.overall=d.overall||{};
    return d;
  }

  async function load(force=false){
    if(cache&&!force)return cache;

    // Excel manual tem prioridade enquanto estiver salvo.
    const imported=await dbGet();
    if(imported?.data){
      cache=normalize(imported.data);
      sourceInfo={
        type:'excel',
        label:'Excel manual',
        updatedAt:imported.importedAt||cache.generated_at,
        fileName:imported.fileName||null
      };
      return cache;
    }

    const u=(c.SHEET_API_URL||'').trim();
    const src=u?`${u}${u.includes('?')?'&':'?'}${force?'nocache=1&':''}t=${Date.now()}`:'data.json';
    const r=await fetch(src,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    cache=normalize(await r.json());
    sourceInfo={
      type:u?'sheets':'local',
      label:u?'Google Sheets':'Arquivo local',
      updatedAt:cache.generated_at||new Date().toISOString(),
      fileName:null
    };
    return cache;
  }

  async function useImportedData(data,fileName){
    cache=normalize(data);
    const record={data:cache,fileName,importedAt:new Date().toISOString()};
    await dbSet(record);
    sourceInfo={type:'excel',label:'Excel manual',updatedAt:record.importedAt,fileName};
    return cache;
  }

  async function clearImportedData(){
    await dbDelete();cache=null;sourceInfo={type:'none',label:'Nenhuma fonte',updatedAt:null,fileName:null};
  }

  function zones(d){
    const s=new Set();
    d.zones.forEach(x=>s.add(String(x.Zona)));
    d.cells.forEach(x=>s.add(String(x.Zona)));
    return [...s].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  }
  function cls(v){
    if(v==null||Number.isNaN(Number(v)))return'blocked';
    v=Number(v);return v>=90?'critical':v>=75?'alert':v>=40?'healthy':'idle';
  }
  function fmt(v){return new Intl.NumberFormat('pt-BR').format(Number(v||0))}
  function getSourceInfo(){return {...sourceInfo}}
  function resetMemory(){cache=null}

  return{load,zones,cls,fmt,config:c,useImportedData,clearImportedData,getSourceInfo,resetMemory};
})();
