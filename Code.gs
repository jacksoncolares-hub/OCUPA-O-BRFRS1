/**
 * API do BRFRS1 Occupancy Center (contrato v3).
 *
 * Publique como Aplicativo da Web: executar como você e acesso para qualquer
 * pessoa com o link. Depois cole a URL /exec em config.js do GitHub Pages.
 */
const SETTINGS = {
  SPREADSHEET_ID: '19MgaGStYysMHGDcb9o1pK21qdD6i3nb7af5WLOaYWgc',
  SHEET_GID: 47098311,
  CACHE_SECONDS: 60,
  ALLOWED_ZONES: ['A', 'B', 'HV', 'HS'],
  ZONE_META: {
    A: { label: 'Zona A', tipo: 'bin' },
    B: { label: 'Zona B', tipo: 'pallet' },
    HV: { label: 'Zona HV', tipo: 'bin' },
    HS: { label: 'Zona HS', tipo: 'bin' }
  }
};

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'data').toLowerCase();
    if (action === 'diagnostic') return output_(diagnostic_());

    const cache = CacheService.getScriptCache();
    const noCache = e && e.parameter && e.parameter.nocache === '1';
    const cached = !noCache && cache.get('BRFRS1_DASHBOARD_V3');
    if (cached) return outputText_(cached);

    const payload = buildDashboardData_();
    const json = JSON.stringify(payload);
    // CacheService rejeita valores grandes. Nunca deixe isso impedir a API.
    if (json.length < 90000) cache.put('BRFRS1_DASHBOARD_V3', json, SETTINGS.CACHE_SECONDS);
    return outputText_(json);
  } catch (error) {
    return output_({ ok: false, error: String(error.message || error), generated_at: timestamp_() });
  }
}

function buildDashboardData_() {
  const sheet = getTargetSheet_();
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) throw new Error('A aba selecionada não possui linhas de dados.');

  const headers = rows[0].map(String);
  const map = mapColumns_(headers);
  const required = ['location', 'pieceLimit', 'realPieces'];
  const missing = required.filter(key => map[key] < 0);
  if (missing.length) {
    throw new Error('Colunas obrigatórias não encontradas: ' + missing.join(', ') + '. Execute ?action=diagnostic para conferir os cabeçalhos.');
  }

  const zoneAgg = {}, roadAgg = {}, cellAgg = {}, metaCalc = {}, positions = [];
  let validRows = 0, ignoredRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.some(value => String(value).trim())) continue;
    const location = String(row[map.location] || '').trim();
    const parsed = parseLocation_(location, map.zone >= 0 ? row[map.zone] : '', map.road >= 0 ? row[map.road] : '');
    if (!parsed || SETTINGS.ALLOWED_ZONES.indexOf(parsed.zone) < 0) { ignoredRows++; continue; }

    const pieces = map.pieces >= 0 ? number_(row[map.pieces]) : 0;
    const pieceLimit = number_(row[map.pieceLimit]);
    const realPieces = number_(row[map.realPieces]);
    const status = normalizeState_(map.status >= 0 ? row[map.status] : '', realPieces);
    const p = parsed;

    increment_(zoneAgg, p.zone, p, status, pieces, pieceLimit, realPieces);
    increment_(roadAgg, p.zone + '|' + p.road, p, status, pieces, pieceLimit, realPieces);
    increment_(cellAgg, p.zone + '|' + p.road + '|' + p.level, p, status, pieces, pieceLimit, realPieces);
    positions.push({
      Zona: p.zone, rua_num: p.road, nivel: p.level, modulo: p.module, posicao: p.position,
      location_id: location, status: status, qtd_pecas: pieces,
      piece_limit: status === 'bloqueado' ? 0 : pieceLimit,
      real_pieces: status === 'bloqueado' ? 0 : realPieces,
      blocked_piece_limit: status === 'bloqueado' ? pieceLimit : 0,
      blocked_real_pieces: status === 'bloqueado' ? realPieces : 0,
      available_pieces: status === 'bloqueado' ? 0 : Math.max(0, pieceLimit - realPieces),
      occ_pct: status === 'bloqueado' || pieceLimit <= 0 ? null : round1_(realPieces / pieceLimit * 100)
    });
    if (!metaCalc[p.zone]) metaCalc[p.zone] = { roads: {}, levels: {}, roadMin: p.road, roadMax: p.road };
    const meta = metaCalc[p.zone];
    meta.roads[p.road] = true; meta.levels[p.level] = true;
    meta.roadMin = Math.min(meta.roadMin, p.road); meta.roadMax = Math.max(meta.roadMax, p.road);
    validRows++;
  }

  const zones = Object.keys(zoneAgg).sort(zoneSort_).map(key => finalize_(zoneAgg[key]));
  const corridors = Object.keys(roadAgg).map(key => finalize_(roadAgg[key])).sort(byLocation_);
  const cells = Object.keys(cellAgg).map(key => finalize_(cellAgg[key])).sort(byLocation_);
  const overall = emptyAggregate_('GERAL', 0, 0);
  zones.forEach(zone => addAggregate_(overall, zone));
  const meta = {};
  Object.keys(metaCalc).forEach(zone => {
    const item = metaCalc[zone], preset = SETTINGS.ZONE_META[zone] || {};
    meta[zone] = { label: preset.label || 'Zona ' + zone, tipo: preset.tipo || 'bin', ruas: Object.keys(item.roads).length,
      niveis: Math.max.apply(null, Object.keys(item.levels).map(Number)), rua_min: item.roadMin, rua_max: item.roadMax };
  });

  return {
    ok: true, schema_version: 3, generated_at: timestamp_(),
    source: { type: 'google_sheets', spreadsheet_id: SETTINGS.SPREADSHEET_ID, sheet_gid: SETTINGS.SHEET_GID, sheet_name: sheet.getName(), valid_rows: validRows, ignored_rows: ignoredRows },
    overall: finalize_(overall), zones: zones, corridors: corridors, cells: cells, positions: positions, stock_trend: [], meta: meta,
    assumptions: ['Ocupação = soma de Qtds Peças Real ÷ soma de Limite Peças p/Arm.', 'Posições bloqueadas não entram na capacidade nem na ocupação.', 'Somente as zonas A, B, HV e HS são consideradas.']
  };
}

function emptyAggregate_(zone, road, level) {
  return { Zona: zone, rua_num: Number(road) || 0, nivel: Number(level) || 0, total: 0, usable_positions: 0, ocupado: 0, disponivel: 0, bloqueado: 0, qtd_pecas: 0, piece_limit: 0, real_pieces: 0 };
}
function increment_(target, key, parsed, status, pieces, limit, real) {
  if (!target[key]) target[key] = emptyAggregate_(parsed.zone, parsed.road, parsed.level);
  const item = target[key]; item.total++; item[status]++;
  if (status !== 'bloqueado') { item.usable_positions++; item.qtd_pecas += pieces; item.piece_limit += Math.max(0, limit); item.real_pieces += Math.max(0, real); }
}
function addAggregate_(target, source) { ['total', 'usable_positions', 'ocupado', 'disponivel', 'bloqueado', 'qtd_pecas', 'piece_limit', 'real_pieces'].forEach(key => target[key] += Number(source[key] || 0)); }
function finalize_(item) { const limit = Number(item.piece_limit || 0), real = Number(item.real_pieces || 0); return { Zona: item.Zona, rua_num: Number(item.rua_num || 0), nivel: Number(item.nivel || 0), total: Number(item.total || 0), usable_positions: Number(item.usable_positions || 0), ocupado: Number(item.ocupado || 0), disponivel: Number(item.disponivel || 0), bloqueado: Number(item.bloqueado || 0), qtd_pecas: round2_(item.qtd_pecas), piece_limit: round2_(limit), real_pieces: round2_(real), available_pieces: round2_(Math.max(0, limit - real)), occ_pct: limit > 0 ? round1_(real / limit * 100) : null }; }

function mapColumns_(headers) { const normalized = headers.map(clean_); return { location: findHeader_(normalized, ['location id', 'location', 'endereço', 'endereco', 'posição', 'posicao', 'storage location', 'bin location']), zone: findHeader_(normalized, ['zona', 'zone', 'area', 'área']), status: findHeader_(normalized, ['status end', 'status', 'location status', 'situação', 'situacao', 'estado']), pieces: findHeader_(normalized, ['qtd peças', 'qtd pecas', 'quantidade', 'qty', 'quantity']), road: findHeader_(normalized, ['pathway id', 'rua2', 'rua', 'corredor', 'aisle', 'pathway']), pieceLimit: findHeader_(normalized, ['limite peças p/arm', 'limite pecas p/arm', 'limite peças p arm', 'limite pecas p arm', 'limite peças', 'limite pecas', 'capacidade peças', 'capacidade pecas']), realPieces: findHeader_(normalized, ['qtds peças real', 'qtds pecas real', 'qtd peças real', 'qtd pecas real', 'quantidade peças real', 'quantidade pecas real', 'peças real', 'pecas real']) }; }
function findHeader_(headers, candidates) { for (let i = 0; i < candidates.length; i++) { const expected = clean_(candidates[i]), index = headers.indexOf(expected); if (index >= 0) return index; } for (let i = 0; i < candidates.length; i++) { const expected = clean_(candidates[i]), index = headers.findIndex(header => header.indexOf(expected) >= 0); if (index >= 0) return index; } return -1; }
function clean_(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }
function number_(value) { if (typeof value === 'number') return isFinite(value) ? value : 0; let text = String(value || '').trim().replace(/\s/g, ''); if (!text) return 0; if (text.indexOf(',') >= 0) text = text.replace(/\./g, '').replace(',', '.'); else text = text.replace(/,/g, ''); const number = Number(text.replace(/[^\d.\-]/g, '')); return isFinite(number) ? number : 0; }
function normalizeState_(value, real) { const status = clean_(value); if (/bloq|block|disable|inativo/.test(status)) return 'bloqueado'; if (/ocup|occupied|full|used/.test(status)) return 'ocupado'; if (/disp|avail|empty|livre|vazio/.test(status)) return 'disponivel'; return Number(real || 0) > 0 ? 'ocupado' : 'disponivel'; }
function parseLocation_(location, zoneValue, roadValue) { const parts = String(location || '').trim().toUpperCase().replace(/[\/\\|_]+/g, '-').split('-').map(value => value.trim()).filter(Boolean); let zone = String(zoneValue || '').trim().toUpperCase(), road = parseInt(String(roadValue || '').replace(/\D/g, ''), 10), level, module, position; const index = parts.findIndex((part, i) => i > 0 && /^[A-Z][A-Z0-9]{0,3}$/.test(part) && parts.length > i + 4); const start = index >= 0 ? index : (parts.length >= 5 ? parts.length - 5 : -1); if (start < 0) return null; if (!zone) zone = parts[start]; if (!isFinite(road)) road = parseInt(parts[start + 1], 10); module = parseInt(parts[start + 2], 10); level = parseInt(parts[start + 3], 10); position = parseInt(parts[start + 4], 10); zone = zone.replace(/[^A-Z0-9]/g, ''); return zone && isFinite(road) && isFinite(level) ? { zone: zone, road: road, module: isFinite(module) ? module : 0, level: level, position: isFinite(position) ? position : 0 } : null; }
function zoneSort_(a, b) { const order = { A: 1, B: 2, HV: 3, HS: 4 }, left = typeof a === 'string' ? a : a.Zona, right = typeof b === 'string' ? b : b.Zona; return (order[left] || 99) - (order[right] || 99) || String(left).localeCompare(String(right)); }
function byLocation_(a, b) { return zoneSort_(a, b) || a.rua_num - b.rua_num || a.nivel - b.nivel; }
function round1_(value) { return Math.round(Number(value || 0) * 10) / 10; }
function round2_(value) { return Math.round(Number(value || 0) * 100) / 100; }
function getTargetSheet_() { const spreadsheet = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID), sheet = spreadsheet.getSheets().find(item => Number(item.getSheetId()) === Number(SETTINGS.SHEET_GID)); if (!sheet) throw new Error('Não encontrei a aba configurada pelo gid ' + SETTINGS.SHEET_GID + '.'); return sheet; }
function diagnostic_() { const sheet = getTargetSheet_(), values = sheet.getDataRange().getDisplayValues(), headers = values.length ? values[0] : []; return { ok: true, sheet_name: sheet.getName(), last_row: sheet.getLastRow(), last_column: sheet.getLastColumn(), headers: headers, normalized_headers: headers.map(clean_), column_mapping: mapColumns_(headers), sample_rows: values.slice(1, 6), generated_at: timestamp_() }; }
function timestamp_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function output_(data) { return outputText_(JSON.stringify(data)); }
function outputText_(text) { return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON); }
