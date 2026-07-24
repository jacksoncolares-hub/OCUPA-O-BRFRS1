/**
 * API DO DASHBOARD BRFRS1
 * Planilha: 19MgaGStYysMHGDcb9o1pK21qdD6i3nb7af5WLOaYWgc
 * Aba identificada pelo gid: 47098311
 *
 * Publicação:
 * 1) Extensões > Apps Script
 * 2) Substitua todo o Code.gs por este conteúdo
 * 3) Implantar > Nova implantação > Aplicativo da Web
 * 4) Executar como: Eu
 * 5) Quem pode acessar: Qualquer pessoa
 * 6) Copie a URL terminada em /exec
 */

const SETTINGS = {
  SPREADSHEET_ID: '19MgaGStYysMHGDcb9o1pK21qdD6i3nb7af5WLOaYWgc',
  SHEET_GID: 47098311,
  CACHE_SECONDS: 120,
  ZONE_META: {
    A:  { label: 'Zona A · Bins de Separação', tipo: 'bin' },
    B:  { label: 'Zona B · Porta-paletes', tipo: 'pallet' },
    HV: { label: 'Zona HV · Bins de Volume', tipo: 'bin' },
    S:  { label: 'Zona S · Bins Especiais', tipo: 'bin' }
  }
};

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'data').toLowerCase();

    if (action === 'diagnostic') {
      return jsonOutput_(diagnostic_());
    }

    const cache = CacheService.getScriptCache();
    const cached = cache.get('BRFRS1_DASHBOARD_DATA_V2');
    if (cached && !(e && e.parameter && e.parameter.nocache === '1')) {
      return ContentService
        .createTextOutput(cached)
        .setMimeType(ContentService.MimeType.JSON);
    }

    const payload = buildDashboardData_();
    const json = JSON.stringify(payload);
    cache.put('BRFRS1_DASHBOARD_DATA_V2', json, SETTINGS.CACHE_SECONDS);

    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return jsonOutput_({
      ok: false,
      error: String(error && error.message ? error.message : error),
      stack: String(error && error.stack ? error.stack : ''),
      generated_at: formatDate_(new Date())
    });
  }
}

function buildDashboardData_() {
  const sheet = getTargetSheet_();
  const values = sheet.getDataRange().getDisplayValues();

  if (values.length < 2) {
    throw new Error('A aba selecionada não possui linhas de dados.');
  }

  const headers = values[0].map(cleanHeader_);
  const map = mapColumns_(headers);

  if (map.location < 0) {
    throw new Error(
      'Não encontrei a coluna de localização. Cabeçalhos encontrados: ' +
      values[0].join(' | ')
    );
  }

  const zoneAgg = {};
  const roadAgg = {};
  const cellAgg = {};
  const metaCalc = {};
  let validRows = 0;
  let ignoredRows = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row.some(v => String(v).trim() !== '')) continue;

    const locationId = String(row[map.location] || '').trim();
    const parsed = parseLocation_(locationId, map.zone >= 0 ? row[map.zone] : '');

    if (!parsed) {
      ignoredRows++;
      continue;
    }

    const zone = parsed.zone;
    const road = parsed.road;
    const level = parsed.level;

    if (!zone || !road || !level) {
      ignoredRows++;
      continue;
    }

    const pieces = map.pieces >= 0 ? parseNumber_(row[map.pieces]) : 0;
    const rawStatus = map.status >= 0 ? row[map.status] : '';
    const state = normalizeState_(rawStatus, pieces);

    increment_(zoneAgg, zone, zone, road, level, state, pieces);
    increment_(roadAgg, zone + '|' + road, zone, road, level, state, pieces);
    increment_(cellAgg, zone + '|' + road + '|' + level, zone, road, level, state, pieces);

    if (!metaCalc[zone]) {
      metaCalc[zone] = { roads: {}, levels: {}, roadMin: road, roadMax: road };
    }
    metaCalc[zone].roads[road] = true;
    metaCalc[zone].levels[level] = true;
    metaCalc[zone].roadMin = Math.min(metaCalc[zone].roadMin, road);
    metaCalc[zone].roadMax = Math.max(metaCalc[zone].roadMax, road);

    validRows++;
  }

  const zones = Object.keys(zoneAgg)
    .sort(zoneSort_)
    .map(k => finalize_(zoneAgg[k]));

  const corridors = Object.keys(roadAgg)
    .map(k => finalize_(roadAgg[k]))
    .sort((a, b) => zoneSort_(a.Zona, b.Zona) || a.rua_num - b.rua_num);

  const cells = Object.keys(cellAgg)
    .map(k => finalize_(cellAgg[k]))
    .sort((a, b) =>
      zoneSort_(a.Zona, b.Zona) ||
      a.rua_num - b.rua_num ||
      a.nivel - b.nivel
    );

  const overallRaw = {
    Zona: 'GERAL',
    rua_num: 0,
    nivel: 0,
    total: 0,
    ocupado: 0,
    disponivel: 0,
    bloqueado: 0,
    qtd_pecas: 0
  };

  zones.forEach(z => {
    overallRaw.total += z.total;
    overallRaw.ocupado += z.ocupado;
    overallRaw.disponivel += z.disponivel;
    overallRaw.bloqueado += z.bloqueado;
    overallRaw.qtd_pecas += z.qtd_pecas;
  });

  const meta = {};
  Object.keys(metaCalc).forEach(zone => {
    const calc = metaCalc[zone];
    const preset = SETTINGS.ZONE_META[zone] || {};
    meta[zone] = {
      label: preset.label || ('Zona ' + zone),
      tipo: preset.tipo || 'bin',
      ruas: Object.keys(calc.roads).length,
      niveis: Math.max.apply(null, Object.keys(calc.levels).map(Number)),
      rua_min: calc.roadMin,
      rua_max: calc.roadMax
    };
  });

  return {
    ok: true,
    generated_at: formatDate_(new Date()),
    source: {
      spreadsheet_id: SETTINGS.SPREADSHEET_ID,
      sheet_gid: SETTINGS.SHEET_GID,
      sheet_name: sheet.getName(),
      valid_rows: validRows,
      ignored_rows: ignoredRows
    },
    overall: finalize_(overallRaw),
    zones: zones,
    corridors: corridors,
    cells: cells,
    stock_trend: [],
    meta: meta,
    assumptions: [
      'Ocupação = ocupado ÷ (ocupado + disponível).',
      'Posições bloqueadas ficam fora do percentual de ocupação.',
      'A localização é interpretada pelos quatro últimos blocos: zona, rua, nível e posição.'
    ]
  };
}

function diagnostic_() {
  const sheet = getTargetSheet_();
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.length ? values[0] : [];
  return {
    ok: true,
    spreadsheet_id: SETTINGS.SPREADSHEET_ID,
    sheet_gid: SETTINGS.SHEET_GID,
    sheet_name: sheet.getName(),
    last_row: sheet.getLastRow(),
    last_column: sheet.getLastColumn(),
    headers: headers,
    normalized_headers: headers.map(cleanHeader_),
    column_mapping: mapColumns_(headers.map(cleanHeader_)),
    sample_rows: values.slice(1, 6),
    generated_at: formatDate_(new Date())
  };
}

function getTargetSheet_() {
  const ss = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => Number(s.getSheetId()) === Number(SETTINGS.SHEET_GID));

  if (!sheet) {
    throw new Error(
      'Não encontrei uma aba com gid ' + SETTINGS.SHEET_GID +
      '. Abas disponíveis: ' +
      ss.getSheets().map(s => s.getName() + ' (' + s.getSheetId() + ')').join(', ')
    );
  }
  return sheet;
}

function mapColumns_(headers) {
  return {
    location: findHeader_(headers, [
      'location id', 'location', 'endereco', 'endereço',
      'posicao', 'posição', 'storage location', 'bin location'
    ]),
    zone: findHeader_(headers, [
      'zona', 'zone', 'area', 'área'
    ]),
    status: findHeader_(headers, [
      'status end', 'status', 'location status', 'situacao',
      'situação', 'estado', 'status da posicao', 'status da posição'
    ]),
    pieces: findHeader_(headers, [
      'qtd pecas', 'qtd peças', 'quantidade pecas', 'quantidade peças',
      'qty', 'quantity', 'pieces', 'unit qty', 'sku qty',
      'quantidade', 'unidades'
    ])
  };
}

function findHeader_(headers, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const exact = cleanHeader_(candidates[i]);
    const index = headers.indexOf(exact);
    if (index >= 0) return index;
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = cleanHeader_(candidates[i]);
    const index = headers.findIndex(h => h.indexOf(candidate) >= 0);
    if (index >= 0) return index;
  }

  return -1;
}

function cleanHeader_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseLocation_(locationId, zoneCell) {
  const raw = String(locationId || '').trim().toUpperCase();
  if (!raw) return null;

  const parts = raw
    .replace(/[\/\\|_]+/g, '-')
    .split('-')
    .map(v => v.trim())
    .filter(Boolean);

  let zone = String(zoneCell || '').trim().toUpperCase();
  let road = null;
  let level = null;

  // Formato mais comum: A-23-05-018
  // Também aceita prefixo: BRFRS1-A-23-05-018
  if (parts.length >= 4) {
    const tail = parts.slice(-4);
    if (!zone) zone = tail[0];
    road = parseInt(tail[1], 10);
    level = parseInt(tail[2], 10);
  }

  // Fallback para formatos com zona em outra posição.
  if ((!zone || !Number.isFinite(road) || !Number.isFinite(level)) && parts.length >= 3) {
    const zoneIndex = parts.findIndex(p => /^[A-Z]{1,3}$/.test(p));
    if (zoneIndex >= 0 && parts.length > zoneIndex + 2) {
      zone = zone || parts[zoneIndex];
      road = parseInt(parts[zoneIndex + 1], 10);
      level = parseInt(parts[zoneIndex + 2], 10);
    }
  }

  zone = String(zone || '').replace(/[^A-Z0-9]/g, '');

  if (!zone || !Number.isFinite(road) || !Number.isFinite(level)) return null;

  return { zone: zone, road: road, level: level };
}

function normalizeState_(statusValue, pieces) {
  const status = cleanHeader_(statusValue);

  if (
    status.indexOf('bloq') >= 0 ||
    status.indexOf('block') >= 0 ||
    status.indexOf('disable') >= 0 ||
    status.indexOf('inativo') >= 0
  ) return 'bloqueado';

  if (
    status.indexOf('ocup') >= 0 ||
    status.indexOf('occupied') >= 0 ||
    status.indexOf('full') >= 0 ||
    status.indexOf('used') >= 0
  ) return 'ocupado';

  if (
    status.indexOf('disp') >= 0 ||
    status.indexOf('avail') >= 0 ||
    status.indexOf('empty') >= 0 ||
    status.indexOf('livre') >= 0 ||
    status.indexOf('vazio') >= 0
  ) return 'disponivel';

  // Caso o status não seja reconhecido, usa a quantidade como fallback.
  return Number(pieces || 0) > 0 ? 'ocupado' : 'disponivel';
}

function increment_(target, key, zone, road, level, state, pieces) {
  if (!target[key]) {
    target[key] = {
      Zona: zone,
      rua_num: Number(road) || 0,
      nivel: Number(level) || 0,
      total: 0,
      ocupado: 0,
      disponivel: 0,
      bloqueado: 0,
      qtd_pecas: 0
    };
  }

  target[key].total++;
  target[key][state]++;
  target[key].qtd_pecas += Number(pieces || 0);
}

function finalize_(obj) {
  const usable = Number(obj.ocupado || 0) + Number(obj.disponivel || 0);
  return {
    Zona: obj.Zona,
    rua_num: Number(obj.rua_num || 0),
    nivel: Number(obj.nivel || 0),
    total: Number(obj.total || 0),
    ocupado: Number(obj.ocupado || 0),
    disponivel: Number(obj.disponivel || 0),
    bloqueado: Number(obj.bloqueado || 0),
    occ_pct: usable > 0 ? Math.round((1000 * Number(obj.ocupado || 0)) / usable) / 10 : null,
    qtd_pecas: Math.round(Number(obj.qtd_pecas || 0) * 100) / 100
  };
}

function parseNumber_(value) {
  if (typeof value === 'number') return value;
  let text = String(value || '').trim();
  if (!text) return 0;

  text = text.replace(/\s/g, '');

  // Formato brasileiro: 1.234,56
  if (text.indexOf(',') >= 0) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }

  text = text.replace(/[^\d.\-]/g, '');
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function zoneSort_(a, b) {
  const order = { A: 1, B: 2, HV: 3, S: 4 };
  const za = typeof a === 'string' ? a : a.Zona;
  const zb = typeof b === 'string' ? b : b.Zona;
  return (order[za] || 99) - (order[zb] || 99) || String(za).localeCompare(String(zb));
}

function formatDate_(date) {
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone() || 'America/Sao_Paulo',
    'dd/MM/yyyy HH:mm:ss'
  );
}

function jsonOutput_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
