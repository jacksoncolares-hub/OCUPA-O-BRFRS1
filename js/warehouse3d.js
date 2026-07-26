const $ = selector => document.querySelector(selector);
let data, scene, camera, renderer, controls, warehouse;
let zone, level = 'all', hasCameraPosition = false;
const params = new URLSearchParams(location.search);
const STATUS_STYLE = {
  critical: 0xef4444,
  alert: 0xf59e0b,
  healthy: 0x22c55e,
  idle: 0x94a3b8,
  blocked: 0x475569
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  status('loading', 'Carregando');
  try {
    data = await WMS.load();
    if (!WMS.zones(data).length) throw new Error('A fonte não possui dados. Configure a URL do Apps Script em config.js.');
    setupUi(); setupScene(); renderWarehouse();
    const source = WMS.getSourceInfo();
    status('ok', source.type === 'sheets' ? 'Google Sheets conectado' : source.label);
    setTimeout(() => window.updateSourceBadge?.(), 0);
  } catch (error) {
    console.error(error); status('error', 'Falha ao carregar');
    $('#viewerInfo').textContent = error.message;
  }
}

function setupUi() {
  const zones = WMS.zones(data);
  $('#zoneSelect').innerHTML = zones.map(value => `<option value="${value}">${value}</option>`).join('');
  zone = params.get('zone') || WMS.config.DEFAULT_ZONE || zones[0];
  if (!zones.includes(zone)) zone = zones[0];
  $('#zoneSelect').value = zone;
  $('#zoneSelect').addEventListener('change', event => { zone = event.target.value; fillLevels(); hasCameraPosition = false; renderWarehouse(); });
  fillLevels();
  const requestedLevel = params.get('level');
  if (requestedLevel && [...$('#levelSelect').options].some(option => option.value === requestedLevel)) { level = requestedLevel; $('#levelSelect').value = level; }
  $('#levelSelect').addEventListener('change', event => { level = event.target.value; renderWarehouse(); });
  $('#searchInput').addEventListener('input', debounce(renderWarehouse, 180));
  $('#searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); focusAddress(); } });
  $('#droneBtn').onclick = () => { camera.position.set(0, 80, 62); controls.target.set(0, 0, 0); hasCameraPosition = true; requestRender(); };
  $('#operatorBtn').onclick = () => { camera.position.set(0, 5, 42); controls.target.set(0, 4, 0); hasCameraPosition = true; requestRender(); };
}

function fillLevels() {
  const levels = [...new Set((data.positions || data.cells).filter(item => String(item.Zona) === zone).map(item => Number(item.nivel)))].sort((a, b) => a - b);
  $('#levelSelect').innerHTML = '<option value="all">Todos</option>' + levels.map(value => `<option value="${value}">Nível ${String(value).padStart(2, '0')}</option>`).join('');
  if (level !== 'all' && !levels.includes(Number(level))) level = 'all';
  $('#levelSelect').value = level;
}

function setupScene() {
  const host = $('#viewer');
  scene = new THREE.Scene(); scene.background = new THREE.Color(0xeaf1f7); scene.fog = new THREE.Fog(0xeaf1f7, 85, 280);
  camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); renderer.setSize(host.clientWidth, host.clientHeight); renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.addEventListener('change', requestRender);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8494a5, 2));
  const light = new THREE.DirectionalLight(0xffffff, 1.4); light.position.set(32, 55, 26); scene.add(light);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(360, 240), new THREE.MeshStandardMaterial({ color: 0xdce5ed, roughness: 0.92 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  scene.add(new THREE.GridHelper(300, 60, 0xb8c5d1, 0xcbd5df)); warehouse = new THREE.Group(); scene.add(warehouse);
  addEventListener('resize', () => { camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight); requestRender(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRender(); });
}

function renderWarehouse() {
  clearWarehouse();
  const positions = selectedPositions();
  if (!positions.length) { $('#viewerInfo').textContent = 'Nenhuma posição encontrada para este filtro.'; requestRender(); return; }
  const roads = [...new Set(positions.map(item => Number(item.rua_num)))].sort((a, b) => a - b);
  const maxModule = Math.max(...positions.map(item => Number(item.modulo) || 1));
  const roadIndex = new Map(roads.map((road, index) => [road, index]));
  const groups = new Map(Object.keys(STATUS_STYLE).map(key => [key, []]));
  positions.forEach(position => groups.get(statusKey(position)).push(position));
  const box = new THREE.BoxGeometry(2.5, 1.4, 0.46);
  const matrix = new THREE.Matrix4();
  groups.forEach((items, key) => {
    if (!items.length) return;
    const material = new THREE.MeshStandardMaterial({ color: STATUS_STYLE[key], roughness: 0.72, transparent: key !== 'blocked', opacity: key === 'blocked' ? 0.72 : 0.9 });
    const mesh = new THREE.InstancedMesh(box, material, items.length);
    items.forEach((item, index) => {
      const x = (roadIndex.get(Number(item.rua_num)) - (roads.length - 1) / 2) * 3.25;
      const y = Number(item.nivel) * 2.05 - 0.65;
      const z = ((Number(item.modulo) || 1) - (maxModule + 1) / 2) * 2.8 + ((Number(item.posicao) || 0) % 6) * 0.5;
      matrix.makeTranslation(x, y, z); mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; warehouse.add(mesh);
  });
  addRoadFrames(roads, maxModule);
  if (!hasCameraPosition) {
    camera.position.set(Math.max(28, roads.length * 2.5), 34, Math.max(40, maxModule * 2.2 + 25));
    controls.target.set(0, 5, 0); hasCameraPosition = true;
  }
  $('#viewerInfo').textContent = `Zona ${zone} · ${roads.length} ruas · ${positions.length.toLocaleString('pt-BR')} posições · instanciado para alto desempenho`;
  requestRender();
}

function selectedPositions() {
  const query = $('#searchInput').value.trim().toUpperCase();
  const source = data.positions && data.positions.length ? data.positions : syntheticPositions(data.cells || []);
  return source.filter(item => String(item.Zona) === zone && (level === 'all' || Number(item.nivel) === Number(level)) && (!query || String(item.location_id || '').toUpperCase().includes(query)));
}

function syntheticPositions(cells) {
  return cells.flatMap(cell => Array.from({ length: Math.min(Number(cell.total) || 0, 200) }, (_, index) => ({ ...cell, modulo: Math.floor(index / 56) + 1, posicao: (index % 56) + 1, location_id: `${cell.Zona}-${cell.rua_num}-${cell.nivel}-${index + 1}`, status: cell.bloqueado === cell.total ? 'bloqueado' : (Number(cell.occ_pct) > 0 ? 'ocupado' : 'disponivel') })));
}
function statusKey(item) { return item.status === 'bloqueado' ? 'blocked' : (WMS.cls(item.occ_pct) || 'idle'); }
function addRoadFrames(roads, maxModule) { const material = new THREE.LineBasicMaterial({ color: 0x667789, transparent: true, opacity: 0.42 }); const width = 1.55, depth = Math.max(5, maxModule * 2.8 + 3), height = 12; roads.forEach((road, index) => { const x = (index - (roads.length - 1) / 2) * 3.25; const points = [[x - width, 0, -depth / 2], [x - width, height, -depth / 2], [x - width, height, depth / 2], [x - width, 0, depth / 2], [x + width, 0, depth / 2], [x + width, height, depth / 2], [x + width, height, -depth / 2], [x + width, 0, -depth / 2]]; warehouse.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point))), material)); }); }
function clearWarehouse() { while (warehouse.children.length) { const object = warehouse.children.pop(); object.geometry?.dispose(); object.material?.dispose(); } }
function focusAddress() { const match = $('#searchInput').value.trim().toUpperCase().match(/(?:BRFRS1-)?([A-Z0-9]+)-(\d+)-(\d+)-(\d+)-(\d+)/); if (!match) return; zone = match[1]; level = match[4]; if ([...$('#zoneSelect').options].some(option => option.value === zone)) { $('#zoneSelect').value = zone; fillLevels(); $('#levelSelect').value = level; hasCameraPosition = false; renderWarehouse(); } }
function requestRender() { if (!renderer || document.hidden) return; renderer.render(scene, camera); }
function status(kind, text) { $('#status').className = `status ${kind}`; $('#status').innerHTML = `<i></i>${text}`; }
function debounce(fn, delay) { let timer; return () => { clearTimeout(timer); timer = setTimeout(fn, delay); }; }
