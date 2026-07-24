
(()=>{
  const $=s=>document.querySelector(s);
  let selectedFile=null;
  const modal=$('#excelModal');
  if(!modal||!$('#importExcelBtn'))return;

  $('#importExcelBtn').onclick=open;
  document.querySelectorAll('[data-close-modal]').forEach(e=>e.onclick=close);
  $('#chooseExcelBtn').onclick=()=>$('#excelFileInput').click();
  $('#excelFileInput').onchange=e=>select(e.target.files?.[0]);
  $('#processExcelBtn').onclick=process;
  $('#clearManualBtn').onclick=clearManual;

  const dz=$('#dropZone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
  dz.addEventListener('drop',e=>select(e.dataTransfer.files?.[0]));

  function open(){modal.classList.add('open');modal.setAttribute('aria-hidden','false')}
  function close(){if($('#importProgress').classList.contains('working'))return;modal.classList.remove('open');modal.setAttribute('aria-hidden','true')}
  function select(file){
    if(!file)return;
    selectedFile=file;
    $('#fileSelected').classList.remove('hidden');
    $('#fileSelected').innerHTML=`<b>${escapeHtml(file.name)}</b><span>${formatBytes(file.size)}</span>`;
    $('#processExcelBtn').disabled=false;
    $('#importResult').classList.add('hidden');
  }
  async function process(){
    if(!selectedFile)return;
    toggleWorking(true);
    result('');
    progress(2,'Preparando importação');
    try{
      const out=await ExcelImport.read(selectedFile,{onProgress:(p,t)=>progress(p,t)});
      await WMS.useImportedData(out.data,selectedFile.name);
      progress(100,'Dashboard atualizado');
      result(`✅ <b>Importação concluída</b><br>${WMS.fmt(out.data.source.valid_rows)} posições carregadas · ${WMS.fmt(out.data.source.ignored_rows)} ignoradas · Aba: ${escapeHtml(out.selectedSheet)}`,'success');
      updateSourceBadge();
      setTimeout(()=>location.reload(),900);
    }catch(e){
      console.error(e);
      result(`❌ <b>Não foi possível importar.</b><br>${escapeHtml(e.message)}`,'error');
    }finally{toggleWorking(false)}
  }
  async function clearManual(){
    toggleWorking(true);
    try{
      await WMS.clearImportedData();
      result('✅ O Excel manual foi removido. O dashboard voltará a consultar o Google Sheets.','success');
      setTimeout(()=>location.reload(),700);
    }catch(e){result('❌ '+escapeHtml(e.message),'error')}
    finally{toggleWorking(false)}
  }
  function progress(p,t){
    $('#importProgress').classList.remove('hidden');
    $('#progressPct').textContent=`${Math.round(p)}%`;
    $('#progressText').textContent=t||'Processando';
    $('#progressBar').style.width=`${Math.max(0,Math.min(100,p))}%`;
  }
  function result(html,type=''){
    const el=$('#importResult');
    if(!html){el.className='import-result hidden';el.innerHTML='';return}
    el.className=`import-result ${type}`;el.innerHTML=html;
  }
  function toggleWorking(v){
    $('#importProgress').classList.toggle('working',v);
    $('#processExcelBtn').disabled=v||!selectedFile;
    $('#clearManualBtn').disabled=v;
    $('#chooseExcelBtn').disabled=v;
  }
  function updateSourceBadge(){
    const el=$('#sourceBadge');if(!el)return;
    const s=WMS.getSourceInfo();
    el.textContent=s.type==='excel'?`Fonte: Excel manual${s.fileName?' · '+s.fileName:''}`:`Fonte: ${s.label}`;
    el.className=`source-badge ${s.type}`;
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function formatBytes(n){if(n<1024)return`${n} B`;if(n<1048576)return`${(n/1024).toFixed(1)} KB`;return`${(n/1048576).toFixed(1)} MB`}
  window.updateSourceBadge=updateSourceBadge;
})();
