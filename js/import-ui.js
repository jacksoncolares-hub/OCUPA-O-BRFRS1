
(()=>{
  const $=s=>document.querySelector(s);
  const dialog=$('#excelDialog');
  const trigger=$('#importExcelBtn');
  if(!dialog||!trigger)return;

  let selectedFile=null;
  let busy=false;

  trigger.addEventListener('click',openDialog);
  $('#closeExcelDialogBtn').addEventListener('click',closeDialog);
  $('#cancelExcelBtn').addEventListener('click',closeDialog);
  $('#chooseExcelBtn').addEventListener('click',()=>$('#excelFileInput').click());
  $('#excelFileInput').addEventListener('change',e=>selectFile(e.target.files?.[0]));
  $('#processExcelBtn').addEventListener('click',processFile);
  $('#clearManualBtn').addEventListener('click',clearManual);

  dialog.addEventListener('cancel',e=>{
    if(busy){e.preventDefault();return}
  });

  dialog.addEventListener('click',e=>{
    if(busy)return;
    const rect=dialog.getBoundingClientRect();
    const inside=e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom;
    if(!inside)closeDialog();
  });

  const dz=$('#dropZone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{
    e.preventDefault();
    if(!busy)dz.classList.add('dragging');
  }));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{
    e.preventDefault();
    dz.classList.remove('dragging');
  }));
  dz.addEventListener('drop',e=>{
    if(!busy)selectFile(e.dataTransfer.files?.[0]);
  });

  function openDialog(){
    refreshDialogSource();
    if(typeof dialog.showModal==='function')dialog.showModal();
    else dialog.setAttribute('open','');
    document.body.classList.add('dialog-open');
  }

  function closeDialog(){
    if(busy)return;
    if(dialog.open)dialog.close();
    else dialog.removeAttribute('open');
    document.body.classList.remove('dialog-open');
  }

  function selectFile(file){
    if(!file)return;
    selectedFile=file;
    const selected=$('#fileSelected');
    selected.classList.remove('hidden');
    selected.innerHTML=`
      <div class="selected-file-main">
        <div class="mini-excel-icon">X</div>
        <div><strong>${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span></div>
      </div>
      <span class="file-ready">Pronto para importar</span>`;
    $('#processExcelBtn').disabled=false;
    setResult('');
    resetProgress();
  }

  async function processFile(){
    if(!selectedFile)return;
    setBusy(true);
    setResult('');
    setProgress(2,'Preparando importação');

    try{
      const out=await ExcelImport.read(selectedFile,{
        onProgress:(pct,text)=>setProgress(pct,text)
      });

      if(!window.WMS||typeof WMS.useImportedData!=='function'){
        throw new Error('Arquivos desatualizados no navegador. Pressione Ctrl + F5 e tente novamente.');
      }

      await WMS.useImportedData(out.data,selectedFile.name);
      setProgress(100,'Dashboard atualizado');
      setResult(
        `✅ <b>Importação concluída</b><br>
        ${WMS.fmt(out.data.source.valid_rows)} posições carregadas ·
        ${WMS.fmt(out.data.source.ignored_rows)} ignoradas ·
        Aba: ${escapeHtml(out.selectedSheet)}`,
        'success'
      );
      refreshDialogSource();
      window.updateMainSourceBadge?.();

      setTimeout(()=>location.reload(),1100);
    }catch(error){
      console.error(error);
      setResult(`❌ <b>Não foi possível importar.</b><br>${escapeHtml(error.message)}`,'error');
    }finally{
      setBusy(false);
    }
  }

  async function clearManual(){
    setBusy(true);
    try{
      await WMS.clearImportedData();
      setResult('✅ O Excel manual foi removido. O dashboard voltará a consultar o Google Sheets.','success');
      refreshDialogSource();
      setTimeout(()=>location.reload(),800);
    }catch(error){
      setResult(`❌ ${escapeHtml(error.message)}`,'error');
    }finally{
      setBusy(false);
    }
  }

  function setBusy(value){
    busy=value;
    dialog.classList.toggle('is-busy',value);
    $('#processExcelBtn').disabled=value||!selectedFile;
    $('#clearManualBtn').disabled=value;
    $('#cancelExcelBtn').disabled=value;
    $('#closeExcelDialogBtn').disabled=value;
    $('#chooseExcelBtn').disabled=value;
  }

  function setProgress(pct,text){
    const progress=$('#importProgress');
    progress.classList.remove('hidden');
    $('#progressPct').textContent=`${Math.round(pct)}%`;
    $('#progressText').textContent=text||'Processando';
    $('#progressBar').style.width=`${Math.max(0,Math.min(100,pct))}%`;
  }

  function resetProgress(){
    $('#importProgress').classList.add('hidden');
    $('#progressBar').style.width='0%';
    $('#progressPct').textContent='0%';
  }

  function setResult(html,type=''){
    const el=$('#importResult');
    if(!html){
      el.className='dialog-result hidden';
      el.innerHTML='';
      return;
    }
    el.className=`dialog-result ${type}`;
    el.innerHTML=html;
  }

  function refreshDialogSource(){
    const source=WMS.getSourceInfo?.()||{};
    $('#dialogSourceText').textContent=
      source.type==='excel'
        ? `Excel manual${source.fileName?` · ${source.fileName}`:''}`
        : source.label||'Google Sheets';

    const dt=source.updatedAt?new Date(source.updatedAt):null;
    $('#dialogUpdatedAt').textContent=
      dt&&!Number.isNaN(dt.getTime())
        ?dt.toLocaleString('pt-BR')
        :'—';
  }

  function escapeHtml(value){
    return String(value).replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[char]);
  }

  function formatBytes(bytes){
    if(bytes<1024)return`${bytes} B`;
    if(bytes<1048576)return`${(bytes/1024).toFixed(1)} KB`;
    return`${(bytes/1048576).toFixed(1)} MB`;
  }

  window.updateSourceBadge=window.updateSourceBadge||function(){};
})();
