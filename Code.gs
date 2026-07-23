/**
 * PAINEL DE OCUPAÇÃO — BRFRS1 (Google Apps Script)
 * ------------------------------------------------
 * Le a aba "Location" de uma Google Sheet (mesmas colunas do export do WMS:
 * Zona, Location ID, Status End, Qtd Peças, etc.), calcula a ocupação por
 * corredor/nível e envia por e-mail um relatório diário em HTML no estilo
 * do painel (heatmap 2D em tabela + KPIs).
 *
 * INSTALAÇÃO
 * 1. Crie uma planilha Google com uma aba "Location" contendo as MESMAS
 *    colunas do arquivo exportado do WMS (cole os dados ali todo dia, ou
 *    conecte via importação/rotina que já exista na empresa).
 * 2. Extensões > Apps Script, cole este arquivo como Code.gs.
 * 3. Ajuste CONFIG abaixo (planilha, destinatários).
 * 4. Rode `configurarGatilhoDiario` uma vez (menu Executar) para autorizar
 *    o script e criar o disparo diário automático.
 * 5. Pronto: todo dia no horário definido, o script recalcula a ocupação
 *    e envia o e-mail.
 */

const CONFIG = {
  SHEET_NAME: 'Location',           // aba com os dados brutos do WMS
  DESTINATARIOS: 'seuemail@empresa.com', // separar por vírgula para vários
  ASSUNTO: 'Painel de Ocupação BRFRS1 — Relatório Diário',
  HORA_ENVIO: 7,                    // hora do dia (0-23) para o disparo diário
  ZONAS: {
    'A':  { label: 'Zona A · Bins de Separação', tipo: 'bin' },
    'HV': { label: 'Zona HV · Bins de Volume',   tipo: 'bin' },
    'B':  { label: 'Zona B · Porta-Paletes',     tipo: 'pallet' },
    'S':  { label: 'Zona S · Bins Especiais',    tipo: 'bin' },
  }
};

/** Cria (ou recria) o gatilho diário. Rode isso uma vez manualmente. */
function configurarGatilhoDiario() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'enviarRelatorioDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarRelatorioDiario')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.HORA_ENVIO)
    .create();
  Logger.log('Gatilho diário configurado às ' + CONFIG.HORA_ENVIO + 'h.');
}

/** Função principal: lê os dados, agrega e envia o e-mail. Também pode ser rodada manualmente. */
function enviarRelatorioDiario() {
  const dados = lerDadosLocation_();
  const agregados = agregarOcupacao_(dados);
  const html = montarHtmlRelatorio_(agregados);

  MailApp.sendEmail({
    to: CONFIG.DESTINATARIOS,
    subject: CONFIG.ASSUNTO + ' — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    htmlBody: html
  });
}

/** Lê a aba Location e devolve um array de objetos (uma linha = um objeto). */
function lerDadosLocation_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  return values.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

/** Agrega ocupação por Zona e por Zona+Corredor+Nível, igual à lógica do dashboard. */
function agregarOcupacao_(rows) {
  const porZona = {};      // Zona -> {total,ocupado,disponivel,bloqueado,qtdPecas}
  const porCorredor = {};  // "Zona|Rua" -> {...}

  rows.forEach(r => {
    const zona = r['Zona'];
    if (!CONFIG.ZONAS[zona]) return;

    const locId = String(r['Location ID'] || '');
    const partes = locId.split('-');
    if (partes.length < 6) return;
    const rua = parseInt(partes[2], 10);
    const posNum = parseInt(partes[5], 10);

    const statusEnd = r['Status End'];
    const estado = statusEnd === 'Ocupado' ? 'ocupado'
                 : statusEnd === 'Disponivel' ? 'disponivel'
                 : statusEnd === 'Bloqueado' ? 'bloqueado' : 'outro';

    const qtdPecas = Number(r['Qtd Peças']) || 0;

    if (!porZona[zona]) porZona[zona] = { total: 0, ocupado: 0, disponivel: 0, bloqueado: 0, qtdPecas: 0 };
    porZona[zona].total++;
    porZona[zona][estado] = (porZona[zona][estado] || 0) + 1;
    porZona[zona].qtdPecas += qtdPecas;

    const key = zona + '|' + rua;
    if (!porCorredor[key]) porCorredor[key] = { zona, rua, total: 0, ocupado: 0, disponivel: 0, bloqueado: 0 };
    porCorredor[key].total++;
    porCorredor[key][estado] = (porCorredor[key][estado] || 0) + 1;
  });

  function pct(o) {
    const usable = (o.ocupado || 0) + (o.disponivel || 0);
    return usable > 0 ? Math.round(1000 * o.ocupado / usable) / 10 : null;
  }

  const overall = { total: 0, ocupado: 0, disponivel: 0, bloqueado: 0, qtdPecas: 0 };
  Object.values(porZona).forEach(z => {
    overall.total += z.total; overall.ocupado += z.ocupado || 0;
    overall.disponivel += z.disponivel || 0; overall.bloqueado += z.bloqueado || 0;
    overall.qtdPecas += z.qtdPecas;
  });
  overall.pct = pct(overall);

  const corredoresPorZona = {};
  Object.values(porCorredor).forEach(c => {
    if (!corredoresPorZona[c.zona]) corredoresPorZona[c.zona] = [];
    c.pct = pct(c);
    corredoresPorZona[c.zona].push(c);
  });
  Object.values(corredoresPorZona).forEach(arr => arr.sort((a, b) => a.rua - b.rua));

  return { overall, porZona, corredoresPorZona, pct };
}

/** Monta o HTML do e-mail: KPIs + heatmap em tabela (uma célula por corredor, cor = ocupação). */
function montarHtmlRelatorio_(ag) {
  const laranja = '#EE4D2D';
  const dataHoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');

  function corOcupacao(pct) {
    if (pct === null || pct === undefined) return '#E9EBF1';
    const stops = [[0,[40,199,111]],[40,[166,226,46]],[65,[255,217,61]],[85,[255,154,61]],[100,[232,67,58]]];
    let lo = stops[0], hi = stops[stops.length-1];
    for (let i=0;i<stops.length-1;i++){ if (pct>=stops[i][0] && pct<=stops[i+1][0]){ lo=stops[i]; hi=stops[i+1]; break; } }
    const span = (hi[0]-lo[0])||1, t = Math.max(0, Math.min(1, (pct-lo[0])/span));
    const c = lo[1].map((v,i)=>Math.round(v+(hi[1][i]-v)*t));
    return 'rgb(' + c.join(',') + ')';
  }

  function kpiCard(tag, val, sub, cor) {
    return '<td style="padding:6px;"><div style="background:#fff;border:1px solid #EDEFF3;border-radius:12px;padding:14px 16px;min-width:130px;">' +
      '<div style="font-size:10.5px;color:#8A93A6;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">' + tag + '</div>' +
      '<div style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:' + cor + ';margin-top:4px;">' + val + '</div>' +
      '<div style="font-size:11px;color:#8A93A6;margin-top:2px;">' + sub + '</div></div></td>';
  }

  const o = ag.overall;
  const kpisHtml =
    kpiCard('Posições totais', o.total.toLocaleString('pt-BR'), 'Bins + Porta-paletes', laranja) +
    kpiCard('Ocupadas', o.ocupado.toLocaleString('pt-BR'), Math.round(1000*o.ocupado/o.total)/10 + '% do total', '#FFB300') +
    kpiCard('Disponíveis', o.disponivel.toLocaleString('pt-BR'), Math.round(1000*o.disponivel/o.total)/10 + '% do total', '#28C76F') +
    kpiCard('Bloqueadas', o.bloqueado.toLocaleString('pt-BR'), Math.round(1000*o.bloqueado/o.total)/10 + '% do total', '#E8433A');

  // Heatmap: uma linha por zona, uma célula por corredor (cor = % ocupação do corredor)
  let heatRows = '';
  Object.keys(CONFIG.ZONAS).forEach(zona => {
    const meta = CONFIG.ZONAS[zona];
    const corredores = (ag.corredoresPorZona[zona] || []);
    if (!corredores.length) return;
    const zpct = ag.porZona[zona] ? ag.pct(ag.porZona[zona]) : null;
    let cells = corredores.map(c =>
      '<td title="Rua ' + c.rua + ': ' + (c.pct===null?'-':c.pct+'%') + '" style="width:10px;height:22px;background:' +
      corOcupacao(c.pct) + ';border-radius:3px;"></td>'
    ).join('<td style="width:2px;"></td>');
    heatRows += '<tr>' +
      '<td style="padding:8px 10px 8px 0;font-size:12px;font-weight:700;color:#1F2430;white-space:nowrap;">' +
        meta.label + '<br><span style="font-weight:600;color:#8A93A6;">' + (zpct===null?'-':zpct+'%') + '</span></td>' +
      '<td><table cellpadding="0" cellspacing="0"><tr>' + cells + '</tr></table></td>' +
      '</tr>';
  });

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#F5F6FA;padding:24px;">
    <div style="max-width:680px;margin:0 auto;">
      <div style="background:linear-gradient(100deg,${laranja},#FF9A56);border-radius:16px 16px 0 0;padding:20px 24px;color:#fff;">
        <div style="font-size:18px;font-weight:800;">📦 Painel de Ocupação de Posições</div>
        <div style="font-size:12.5px;opacity:.9;margin-top:2px;">BRFRS1 · Relatório diário · ${dataHoje}</div>
      </div>
      <div style="background:#fff;padding:20px 24px;">
        <table cellpadding="0" cellspacing="0"><tr>${kpisHtml}</tr></table>
      </div>
      <div style="background:#fff;padding:0 24px 20px;">
        <div style="font-size:14px;font-weight:800;color:#1F2430;margin-bottom:10px;">Mapa de calor por corredor</div>
        <table cellpadding="0" cellspacing="0" style="width:100%;">${heatRows}</table>
        <div style="margin-top:10px;font-size:11px;color:#8A93A6;">Verde = livre · Laranja/Vermelho = cheio. Passe o mouse sobre os blocos para ver o corredor (no Gmail web).</div>
      </div>
      <div style="background:#fff;border-radius:0 0 16px 16px;padding:14px 24px;border-top:1px solid #EDEFF3;font-size:11px;color:#8A93A6;">
        Gerado automaticamente pelo Google Apps Script a partir da planilha "${CONFIG.SHEET_NAME}".
      </div>
    </div>
  </div>`;
}
