// Interactive demo: one search per planner, replayed step by step, on the sphere and on the five robot
// scenarios, drawn like the RViz views of the code (start tree orange, goal tree light blue, rejected steps
// magenta, path yellow; on the robots the trees are drawn where the carried object would be). After the
// search, the robot follows the path. Data: static/data/sphere/*.json (tools/make_sphere_data.py) and
// static/data/robots/*.json (rosrun rmrrt web_export).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';

const DATASETS = [
  { id: 'sphere', tab: 'Sphere', note: 'Two narrow gates on the unit sphere', file: 'static/data/sphere/double_gate_5.json' },
  { id: 'panda_orientation', tab: 'S1', note: '7-DoF arm with an orientation constraint', file: 'static/data/robots/panda_orientation.json', view: [-1.1, -0.7, 0.9] },
  { id: 'panda_dual', tab: 'S2', note: '14-DoF dual-arm closed chain', file: 'static/data/robots/panda_dual.json' },
  { id: 'panda_dual_orientation', tab: 'S3', note: 'Dual-arm closed chain with an orientation constraint', file: 'static/data/robots/panda_dual_orientation.json' },
  { id: 'panda_triple', tab: 'S4', note: '21-DoF triple arm carrying a chair among boxes', file: 'static/data/robots/panda_triple.json' },
  { id: 'h1_2_dual', tab: 'S5', note: 'Humanoid carrying a box through a window', file: 'static/data/robots/h1_2_dual.json' },
  { id: 'humanoid_pair', tab: 'Pair', note: 'Two humanoids lift a tray over a divider together', file: 'static/data/robots/humanoid_pair.json', view: [-0.45, -0.9, 0.9], opacity: 0.75 },
];
const PAPER = ['sphere', 'panda_orientation', 'panda_dual', 'panda_dual_orientation', 'panda_triple', 'h1_2_dual'];
const LABELS = { no_metric: 'No-barrier', steer: 'Metric steering', select: 'Node selection', rmrrt: 'RMRRT', cbirrt: 'CBiRRT' };
const HINTS = { no_metric: 'no metric', steer: 'steering only', select: 'selection only', rmrrt: 'ours', cbirrt: 'baseline' };
const COLORS = { start: 0xff9a1a, goal: 0x4dccff, rejected: 0xff33ff, path: 0xffff33, obstacle: 0xd94040, carried: 0xb04fd0 };
const SEARCH_SECONDS = 7;  // replay of a search at speed 1, whatever its length
const SEARCH_RATE = 15;    // ... but at most this many events per second (a short search is drawn, not flashed)
const PATH_SECONDS = 5;    // one pass of the robot along the path

// Each [data-demo] element is one viewer; data-datasets lists its problems (default: the paper's).
document.querySelectorAll('[data-demo]').forEach(root => {
  const ids = (root.dataset.datasets || PAPER.join(',')).split(',');
  const datasets = ids.map(id => DATASETS.find(d => d.id === id)).filter(Boolean);
  const button = root.querySelector('.demo-load');
  button.addEventListener('click', () => {
    button.disabled = true;
    button.querySelector('span').textContent = 'Loading…';
    start(root, datasets).catch(error => { button.querySelector('span').textContent = 'Could not load the demo'; console.error(error); });
  }, { once: true });
});

async function start(root, datasets) {
  const stage = root.querySelector('.demo-stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.prepend(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(32, 16 / 10, 0.02, 100);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const meshes = new Map();  // url -> Promise<Object3D>, shared by every scenario
  const stl = new STLLoader(), collada = new ColladaLoader();
  const loadMesh = url => {
    if (!meshes.has(url)) {
      meshes.set(url, new Promise((resolve, reject) => {
        if (url.toLowerCase().endsWith('.dae')) {
          collada.load(url, dae => { dae.scene.rotation.set(0, 0, 0); dae.scene.updateMatrix(); resolve(dae.scene); }, undefined, reject);
        } else {
          stl.load(url, geometry => {
            geometry.computeVertexNormals();
            resolve(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.1, roughness: 0.6 })));
          }, undefined, reject);
        }
      }));
    }
    return meshes.get(url).then(object => object.clone(true), () => new THREE.Group());  // a missing mesh leaves a gap
  };

  const overlay = root.querySelector('.demo-overlay');
  const final = root.querySelector('.demo-final');
  const tabs = root.querySelector('[data-tabs]');
  const methodBox = root.querySelector('[data-methods]');
  const speed = root.querySelector('[data-speed]');
  const playButton = root.querySelector('[data-play]');
  const note = root.querySelector('[data-note]');
  const compare = root.parentElement.querySelector('[data-compare]');
  root.querySelector('.demo-load').remove();

  let scene = null, view = null, data = null, method = null, shown = 0, cursor = 0, phase = 'search', pathTime = 0, playing = false, last = 0;
  let counts = { step: 0, rejected: 0, skipped: 0 };

  if (datasets.length < 2) tabs.closest('.panel').hidden = true;
  datasets.forEach(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'demo-tab';
    b.textContent = d.tab;
    b.title = d.note;
    b.addEventListener('click', () => open(d));
    tabs.appendChild(b);
  });

  async function open(dataset) {
    [...tabs.children].forEach((b, i) => b.setAttribute('aria-pressed', String(datasets[i] === dataset)));
    note.textContent = dataset.note;
    overlay.querySelector('.name').textContent = 'Loading…';
    final.classList.remove('show');
    playing = false;
    data = await (await fetch(dataset.file)).json();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x303030);
    view = dataset.id === 'sphere' ? buildSphere(scene, data) : await buildRobot(scene, data, loadMesh, dataset.opacity);
    if (dataset.view) view.direction.set(...dataset.view);
    view.lines = [layer(scene, COLORS.start, data), layer(scene, COLORS.goal, data), layer(scene, COLORS.rejected, data)];
    frameCamera(view.bounds);
    methodBox.innerHTML = '';
    data.methods.forEach(m => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'method-btn';
      b.dataset.method = m.id;
      b.innerHTML = `${LABELS[m.id] || m.id} <small>${HINTS[m.id] || ''}</small>`;
      b.addEventListener('click', () => reset(m.id));
      methodBox.appendChild(b);
    });
    fillCompare();
    reset(data.methods.some(m => m.id === 'rmrrt') ? 'rmrrt' : data.methods[0].id);
  }

  function fillCompare() {
    if (!compare) return;
    const ms = data.methods;
    const best = (key, low = true) => ms.reduce((a, m) => ((low ? m[key] < a[key] : m[key] > a[key]) ? m : a), ms[0]).id;
    const row = (label, key, fmt) => {
      const b = best(key);
      return `<tr><td>${label}</td>${ms.map(m => `<td class="${m.id === b ? 'best' : ''}">${fmt(m)}</td>`).join('')}</tr>`;
    };
    const rejected = m => m.rejected ?? m.events.filter(e => e[0] === 1).length;
    ms.forEach(m => { m.rejected_count = rejected(m); });
    compare.innerHTML = `<thead><tr><th>This query</th>${ms.map(m => `<th>${LABELS[m.id] || m.id}</th>`).join('')}</tr></thead><tbody>` +
      row('Planning time', 'seconds', m => time(m.seconds)) +
      row('Collision checks', 'checks', m => m.checks.toLocaleString('en-US')) +
      row('Rejected steps', 'rejected_count', m => m.rejected_count.toLocaleString('en-US')) +
      row('Path length', 'path_length', m => m.path_length.toFixed(2)) + '</tbody>';
  }

  function reset(id) {
    method = data.methods.find(m => m.id === id);
    shown = 0;
    cursor = 0;
    phase = 'search';
    pathTime = 0;
    counts = { step: 0, rejected: 0, skipped: 0 };
    view.lines.forEach(l => { l.count = 0; l.geometry.setDrawRange(0, 0); });
    view.showPath(null);
    view.pose(null);
    final.classList.remove('show');
    [...methodBox.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.method === id)));
    overlay.querySelector('.name').textContent = LABELS[id] || id;
    playing = true;
    playButton.textContent = 'Pause';
    updateOverlay();
  }

  function advance(until) {
    const events = method.events;
    for (; shown < until && shown < events.length; shown++) {
      const e = events[shown];
      if (e[0] === 0) { add(view.lines[e[1]], e); counts.step++; }
      else if (e[0] === 1) { add(view.lines[2], e); counts.rejected++; }
      else counts.skipped++;
    }
    view.lines.forEach(l => { l.geometry.setDrawRange(0, l.count * 2); l.geometry.attributes.position.needsUpdate = true; });
    updateOverlay();
    if (shown >= events.length) {
      phase = 'path';
      view.showPath(method);
      final.innerHTML = `<span>planning time</span><b>${time(method.seconds)}</b>` +
        `<span>collision checks</span><b>${method.checks.toLocaleString('en-US')}</b>` +
        `<span>path length</span><b>${method.path_length.toFixed(2)}</b>`;
      final.classList.add('show');
    }
  }

  function add(target, e) {
    const p = target.geometry.attributes.position.array, k = target.count * 6;
    for (let i = 0; i < 6; i++) p[k + i] = e[2 + i];
    target.count += 1;
  }

  function updateOverlay() {
    overlay.querySelector('.live').textContent = phase === 'path' ? 'path found · the robot follows it' :
      `steps ${counts.step}   ·   rejected ${counts.rejected}   ·   skipped by node selection ${counts.skipped}`;
  }

  function frameCamera(box) {
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    const direction = view.direction.clone().normalize();
    camera.near = size / 100;
    camera.far = size * 20;
    camera.position.copy(center).addScaledVector(direction, size * 1.2);
    controls.target.copy(center);
    controls.update();
    view.home = () => { camera.position.copy(center).addScaledVector(direction, size * 1.2); controls.target.copy(center); controls.update(); };
  }

  playButton.addEventListener('click', () => {
    if (!method) return;
    playing = !playing;
    playButton.textContent = playing ? 'Pause' : 'Play';
  });
  root.querySelector('[data-view]').addEventListener('click', () => view && view.home());
  root.querySelector('[data-replay]').addEventListener('click', () => method && reset(method.id));

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  function frame(time) {
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
    last = time;
    if (playing && method) {
      const s = Number(speed.value);
      if (phase === 'search') {
        cursor += Math.max(method.events.length / SEARCH_SECONDS, SEARCH_RATE) * s * dt;
        advance(Math.floor(cursor));
      } else if (method.frames && method.frames.length) {
        pathTime = (pathTime + dt * s / PATH_SECONDS) % 1.2;  // a short rest at the goal
        view.pose(along(method.frames, ease(Math.min(pathTime, 1))));
      }
    }
    controls.update();
    if (scene) renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  await open(datasets[0]);
}

// ---------------------------------------------------------------- scenes

function time(seconds) {
  return seconds < 0.1 ? `${(seconds * 1e3).toFixed(2)} ms` : `${seconds.toFixed(2)} s`;
}

function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
  const light = new THREE.DirectionalLight(0xffffff, 1.6);
  light.position.set(3, -2, 5);
  scene.add(light);
}

function grid(scene, z, size) {
  const g = new THREE.GridHelper(size, Math.round(size), 0xa0a0a0, 0x5a5a5a);
  g.rotation.x = Math.PI / 2;
  g.position.z = z;
  scene.add(g);
}

function layer(scene, color, data) {
  const capacity = Math.max(...data.methods.map(m => m.events.length), 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
  geometry.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  scene.add(lines);
  return { geometry, count: 0 };
}

function tube(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal', 0);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 3, radius, 6, false), new THREE.MeshBasicMaterial({ color: COLORS.path }));
}

function ball(scene, p, radius, color) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color }));
  m.position.set(...p);
  scene.add(m);
  return m;
}

function buildSphere(scene, data) {
  lights(scene);
  grid(scene, -1, 8);
  const sc = data.scene;
  const obstacles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshPhongMaterial({ color: COLORS.obstacle }), sc.centers.length);
  const m = new THREE.Matrix4();
  sc.centers.forEach((c, i) => {
    m.compose(new THREE.Vector3(...c), new THREE.Quaternion(), new THREE.Vector3(sc.radii[i], sc.radii[i], sc.radii[i]));
    obstacles.setMatrixAt(i, m);
  });
  scene.add(obstacles);
  ball(scene, sc.start, 0.035, 0x33e633);
  ball(scene, sc.goal, 0.035, 0x3380ff);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshPhongMaterial({ color: 0xcccccc, transparent: true, opacity: 0.22, depthWrite: false })));
  // camera toward the opening of the upper ring
  const top = Math.max(...sc.centers.map(c => c[2]));
  const ring = sc.centers.filter(c => Math.abs(c[2] - top) < 0.03).map(c => Math.atan2(c[1], c[0])).sort((a, b) => a - b);
  let gate = 0, widest = -1;
  ring.forEach((a, i) => { const next = i + 1 < ring.length ? ring[i + 1] : ring[0] + 2 * Math.PI; if (next - a > widest) { widest = next - a; gate = a + widest / 2; } });
  let path = null;
  return {
    bounds: new THREE.Box3(new THREE.Vector3(-1.1, -1.1, -1.1), new THREE.Vector3(1.1, 1.1, 1.1)),
    direction: new THREE.Vector3(Math.cos(gate), Math.sin(gate), 0.5),
    showPath(method) {
      if (path) { scene.remove(path); path = null; }
      if (method && method.path.length > 1) { path = tube(method.path.map(q => q.map(x => x * 1.004)), 0.009); scene.add(path); }
    },
    pose() {},
  };
}

// a smooth start and stop along the path
function ease(t) {
  return t * t * (3 - 2 * t);
}

// the link poses at a fraction t of the path, between two of its frames (positions linear, rotations
// normalized linear)
function along(frames, t) {
  if (frames.length < 2) return frames[0];
  const u = t * (frames.length - 1), i = Math.min(frames.length - 2, Math.floor(u)), f = u - i;
  const a = frames[i], b = frames[i + 1], out = new Array(a.length);
  for (let k = 0; k < a.length; k += 7) {
    for (let j = 0; j < 3; j++) out[k + j] = a[k + j] + f * (b[k + j] - a[k + j]);
    const sign = a[k + 3] * b[k + 3] + a[k + 4] * b[k + 4] + a[k + 5] * b[k + 5] + a[k + 6] * b[k + 6] < 0 ? -1 : 1;
    let norm = 0;
    for (let j = 3; j < 7; j++) {
      out[k + j] = a[k + j] + f * (sign * b[k + j] - a[k + j]);
      norm += out[k + j] * out[k + j];
    }
    norm = Math.sqrt(norm);
    for (let j = 3; j < 7; j++) out[k + j] /= norm;
  }
  return out;
}

function poseOf(target, a, k) {
  target.position.set(a[k], a[k + 1], a[k + 2]);
  target.quaternion.set(a[k + 3], a[k + 4], a[k + 5], a[k + 6]);
}

function primitive(o) {
  let geometry;
  if (o.type === 'box') geometry = new THREE.BoxGeometry(...o.size);
  else if (o.type === 'cylinder') geometry = new THREE.CylinderGeometry(o.radius, o.radius, o.length, 32).rotateX(Math.PI / 2);
  else if (o.type === 'sphere') geometry = new THREE.SphereGeometry(o.radius, 24, 16);
  else {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(o.vertices, 3));
    geometry.setIndex(o.triangles);
    geometry.computeVertexNormals();
  }
  return geometry;
}

async function buildRobot(scene, data, loadMesh, opacity = 0.38) {
  lights(scene);
  const bounds = new THREE.Box3();
  // fixed objects: translucent green like the planning scene in RViz
  const objectMaterial = new THREE.MeshStandardMaterial({ color: 0x2ecc40, transparent: true, opacity, roughness: 0.8, depthWrite: opacity > 0.6 });
  data.objects.forEach(o => {
    const mesh = new THREE.Mesh(primitive(o), objectMaterial);
    poseOf(mesh, o.pose, 0);
    scene.add(mesh);
    bounds.expandByObject(mesh);
  });
  // links: a group per link with its visual mesh at the visual origin
  const groups = await Promise.all(data.links.map(async link => {
    const group = new THREE.Group();
    const visual = link.mesh ? await loadMesh(link.mesh) : new THREE.Group();  // the carried object's link may have no mesh
    poseOf(visual, link.origin, 0);
    visual.scale.set(...link.scale);
    group.add(visual);
    group.name = link.name;
    scene.add(group);
    return group;
  }));
  const byName = new Map(groups.map(g => [g.name, g]));
  // carried object, attached to its link
  const c = data.carried;
  let carried;
  if (c.type === 'mesh') {
    carried = await loadMesh(c.mesh);
    carried.traverse(n => { if (n.isMesh) n.material = new THREE.MeshStandardMaterial({ color: COLORS.carried, roughness: 0.7 }); });
  } else {
    carried = new THREE.Mesh(primitive(c), new THREE.MeshStandardMaterial({ color: COLORS.carried, roughness: 0.7 }));
  }
  const holder = new THREE.Group();
  poseOf(holder, c.pose, 0);
  holder.add(carried);
  (byName.get(c.link) || scene).add(holder);
  // start and goal of the carried object
  ball(scene, data.start, 0.02, 0x33e633);
  ball(scene, data.goal, 0.02, 0x3380ff);

  const pose = poses => groups.forEach((g, i) => poseOf(g, poses || data.start_links, 7 * i));
  pose(null);
  groups.forEach(g => { g.updateMatrixWorld(true); bounds.expandByObject(g); });
  const extent = bounds.getSize(new THREE.Vector3());
  grid(scene, bounds.min.z, Math.ceil(Math.max(extent.x, extent.y) + 2));
  // the camera frames the robot at the start and the goal and the paths, not the whole room
  const focus = new THREE.Box3();
  for (const links of [data.start_links, data.goal_links])
    for (let k = 0; k < links.length; k += 7) focus.expandByPoint(new THREE.Vector3(links[k], links[k + 1], links[k + 2]));
  data.methods.forEach(m => m.path.forEach(p => focus.expandByPoint(new THREE.Vector3(...p))));
  focus.expandByScalar(0.2);

  let path = null;
  return {
    bounds: focus,
    direction: new THREE.Vector3(1.2, -0.9, 0.8),
    showPath(method) {
      if (path) { scene.remove(path); path = null; }
      if (method && method.path.length > 1) { path = tube(method.path, 0.004); scene.add(path); }
    },
    pose,
  };
}
