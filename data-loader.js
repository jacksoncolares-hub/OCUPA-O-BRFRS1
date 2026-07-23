
const CONFIG=window.APP_CONFIG||{};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const fmt=n=>Number(n||0).toLocaleString("pt-BR");
const pct=v=>v==null||Number.isNaN(Number(v))?"—":`${Number(v).toFixed(1).replace(".",",")}%`;
const COLORS={green:"#2fc66d",lime:"#c6d32c",yellow:"#ffb429",orange:"#ff7433",red:"#ef3f35",gray:"#8f99a5"};
let DATA=null;
function usable(d){if(!d)return null;if(d.occ_pct!=null&&!Number.isNaN(Number(d.occ_pct)))return Number(d.occ_pct);const u=Number(d.ocupado||0)+Number(d.disponivel||0);return u?100*Number(d.ocupado||0)/u:null}
function heatColor(v){if(v==null)return COLORS.gray;v=Number(v);if(v<50)return COLORS.green;if(v<70)return COLORS.lime;if(v<85)return COLORS.yellow;if(v<95)return COLORS.orange;return COLORS.red}
function corridor(z,r){return (DATA.corridors||[]).find(x=>x.Zona===z&&Number(x.rua_num)===Number(r))}
function cell(z,r,n){return (DATA.cells||[]).find(x=>x.Zona===z&&Number(x.rua_num)===Number(r)&&Number(x.nivel)===Number(n))}
function positionData(z,r,n,p){return (DATA.positions||[]).find(x=>x.Zona===z&&Number(x.rua_num)===Number(r)&&Number(x.nivel)===Number(n)&&Number(x.pos_num)===Number(p))}
function zoneData(z){return (DATA.zones||[]).find(x=>x.Zona===z)||{}}
function toast(t){const e=document.querySelector("#toast");e.textContent=t;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2000)}
async function loadData(){
  const api=String(CONFIG.SHEET_API_URL||"").trim();
  try{
    if(api){const sep=api.includes("?")?"&":"?";const r=await fetch(`${api}${sep}t=${Date.now()}`,{cache:"no-store"});if(!r.ok)throw new Error();DATA=await r.json();document.querySelector("#sourceText").textContent="Google Sheets conectado";}
    else{const r=await fetch(`data.json?t=${Date.now()}`,{cache:"no-store"});DATA=await r.json();document.querySelector("#sourceText").textContent="Dados locais";}
  }catch(e){const r=await fetch(`data.json?t=${Date.now()}`,{cache:"no-store"});DATA=await r.json();document.querySelector("#sourceText").textContent="Fallback local";}
  document.querySelector("#updatedText").textContent=DATA.generated_at||new Date().toLocaleString("pt-BR");
}
