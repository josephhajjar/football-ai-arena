// 3D viewer (Three.js). Plays a "series": { matches:[{frames,events,fx,fps,score,complete,startOffset...}], gap, names }.
// Works for finished replays AND for live series (frames are appended while playing).
// The game itself is simulated on the server; this only draws recorded/streamed frames and effects.
import * as THREE from 'three';
import { CONFIG as C } from '/src/config.js';

const HL = C.HALF_LENGTH, HW = C.HALF_WIDTH, CR = C.CORNER_RADIUS, GH = C.GOAL_HALF_WIDTH;
const COL = { blue: 0x2f7bff, blue2: 0x6aa5ff, red: 0xff4a3d, red2: 0xff8a7e };
const NOFX = { gw: [GH, GH], bombs: [], mud: [], cubes: [0, 0, 0, 0] };
// aura colours by effect bit (priority order: first match wins)
const AURAS = [[8, 0xb06bff], [16, 0x7fe3ff], [1, 0xffe14d], [2, 0xff8a2b], [4, 0xb8c2d4], [64, 0x8a5a2b]];

export const CAMERAS = [
  { id: 'broadcast', label: 'Broadcast', key: '1' },
  { id: 'top', label: 'Top down', key: '2' },
  { id: 'ball', label: 'Ball cam', key: '3' },
  { id: 'blueEnd', label: 'Blue goal', key: '4' },
  { id: 'redEnd', label: 'Red goal', key: '5' },
  { id: 'player', label: 'Cube cam', key: '6' },
  { id: 'orbit', label: 'Free orbit', key: '7' },
];

function outline(hl, hw, r, stepsPerCorner = 14) {
  const pts = [];
  const corners = [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]];
  for (const [sx, sz, a0] of corners) {
    const cx = sx * (hl - r), cz = sz * (hw - r);
    for (let i = 0; i <= stepsPerCorner; i++) {
      const a = ((a0 + (90 * i) / stepsPerCorner) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  }
  return pts;
}

function pitchTexture() {
  const S = 34, w = HL * 2 * S, h = HW * 2 * S;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#2f8a3f' : '#369846'; g.fillRect(i * 5 * S, 0, 5 * S, h); }
  const X = (x) => (x + HL) * S, Z = (z) => (z + HW) * S;
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.18 * S; g.lineJoin = 'round';
  g.beginPath(); g.roundRect(X(-HL + 0.4), Z(-HW + 0.4), (HL * 2 - 0.8) * S, (HW * 2 - 0.8) * S, (CR - 0.4) * S); g.stroke();
  g.beginPath(); g.moveTo(X(0), Z(-HW + 0.4)); g.lineTo(X(0), Z(HW - 0.4)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 5 * S, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(X(0), Z(0), 0.3 * S, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) {
    g.strokeRect(s < 0 ? X(-HL + 0.4) : X(HL - 0.4 - 8), Z(-11), 8 * S, 22 * S);
    g.strokeRect(s < 0 ? X(-HL + 0.4) : X(HL - 0.4 - 3), Z(-6), 3 * S, 12 * S);
    g.beginPath(); g.arc(X(s * (HL - 6)), Z(0), 0.3 * S, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

function ballTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#222';
  const spots = [[20, 30], [70, 90], [128, 20], [128, 108], [190, 60], [236, 100], [236, 28], [60, 60], [160, 100], [100, 52]];
  for (const [x, y] of spots) { g.beginPath(); for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13); } g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function labelSprite(text, color) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect(10, 8, 108, 48, 14); g.fill();
  g.fillStyle = color; g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 33);
  const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true });
  const s = new THREE.Sprite(m); s.scale.set(2.6, 1.3, 1); s.renderOrder = 10; return s;
}

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1424);
    this.scene.fog = new THREE.Fog(0x0b1424, 90, 220);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.camMode = 'broadcast'; this.playerCam = 0;
    this.camPos = new THREE.Vector3(0, 25, 38); this.camLook = new THREE.Vector3();
    this.orbit = { yaw: 0.6, pitch: 0.7, dist: 70 };
    this.series = null; this.getTime = () => 0; this.onHud = () => {}; this.onEvent = () => {};
    this.snapCam = true; this.prevBall = null; this.flash = [0, 0, 0, 0];
    this.shakeAmp = 0; this.blasts = []; this.goalFlash = 0; this.fxNow = NOFX; this.time = 0;
    this.preview = null;
    this.build();
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.last = performance.now();
    const loop = (t) => { const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t; try { this.frame(dt); } catch (e) { console.error(e); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  build() {
    const sc = this.scene;
    sc.add(new THREE.HemisphereLight(0xcfe3ff, 0x1d3a22, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(25, 55, 20); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 35, bottom: -35, near: 10, far: 140 });
    sun.shadow.bias = -0.0004;
    sc.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x0f1c2e, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; sc.add(ground);
    const shape = new THREE.Shape();
    outline(HL, HW, CR).forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
    const pg = new THREE.ShapeGeometry(shape); pg.rotateX(-Math.PI / 2);
    const pos = pg.attributes.position, uv = pg.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + HL) / (2 * HL), 1 - (pos.getZ(i) + HW) / (2 * HW));
    const pitch = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 }));
    pitch.receiveShadow = true; sc.add(pitch); this.pitch = pitch;

    // invisible barrier drawn as a faint glass wall + glowing base line (open at the goal mouths)
    const ring = outline(HL, HW, CR, 18), WH = 3.2, verts = [], lineV = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (Math.abs(a[0]) > HL - 0.01 && Math.abs(b[0]) > HL - 0.01 && Math.abs(a[1]) <= 6 && Math.abs(b[1]) <= 6 && Math.sign(a[0]) === Math.sign(b[0])) continue;
      verts.push(a[0], 0, a[1], b[0], 0, b[1], b[0], WH, b[1], a[0], 0, a[1], b[0], WH, b[1], a[0], WH, a[1]);
      lineV.push(a[0], 0.05, a[1], b[0], 0.05, b[1]);
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    sc.add(new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lineV, 3));
    sc.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.6 })));

    // goals (their width changes with Tight Goal / Wide Goal)
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    this.goals = [];
    for (const s of [-1, 1]) {
      const tint = s < 0 ? COL.blue : COL.red, gx = s * HL, g = { s, cur: GH, posts: [], gx };
      const post = (z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, C.GOAL_HEIGHT, 12), postMat); m.position.set(gx, C.GOAL_HEIGHT / 2, z); m.castShadow = true; sc.add(m); return m; };
      g.posts = [post(-GH), post(GH)];
      g.bar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2, 12), postMat); g.bar.position.set(gx, C.GOAL_HEIGHT, 0); g.bar.rotation.x = Math.PI / 2; sc.add(g.bar);
      const box = new THREE.BoxGeometry(C.GOAL_DEPTH, C.GOAL_HEIGHT, 2);
      g.net = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.13, side: THREE.BackSide, depthWrite: false }));
      g.net.position.set(gx + s * C.GOAL_DEPTH / 2, C.GOAL_HEIGHT / 2, 0); sc.add(g.net);
      g.edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: tint }));
      g.edges.position.copy(g.net.position); sc.add(g.edges);
      g.line = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.9 }));   // goal-line stripe
      g.line.rotation.x = -Math.PI / 2; g.line.position.set(gx - s * 0.3, 0.04, 0); sc.add(g.line);
      this.goals.push(g);
    }
    this.setGoalWidth(0, GH); this.setGoalWidth(1, GH);

    // stands
    const stand = outline(HL + 9, HW + 9, CR + 9, 10), rng = (i) => ((Math.sin(i * 91.7) + 1) * 0.5);
    const sg = new THREE.BoxGeometry(5, 1, 4);
    for (let i = 0; i < stand.length; i++) {
      const [x, z] = stand[i], nx = stand[(i + 1) % stand.length];
      const m = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.6, 0.25, 0.12 + rng(i) * 0.1), roughness: 1 }));
      const h = 3 + rng(i + 7) * 5; m.scale.y = h; m.position.set(x, h / 2, z);
      m.rotation.y = Math.atan2(-(nx[1] - z), nx[0] - x); sc.add(m);
    }

    // cubes with effect auras
    this.cubes = [];
    for (let i = 0; i < 4; i++) {
      const blue = i < 2, g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({ color: blue ? (i ? COL.blue2 : COL.blue) : (i === 3 ? COL.red2 : COL.red), roughness: 0.45, emissive: 0x000000 }));
      body.position.y = 0.75; body.castShadow = true; g.add(body);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.9), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      nose.position.set(0.76, 0.85, 0); g.add(nose);
      const lab = labelSprite((blue ? 'B' : 'R') + ((i % 2) + 1), blue ? '#8fb8ff' : '#ffa59d'); lab.position.y = 2.7; g.add(lab);
      const aura = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.BackSide, depthWrite: false }));
      aura.position.y = 0.8; aura.visible = false; g.add(aura);
      const ringM = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.07, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
      ringM.rotation.x = Math.PI / 2; ringM.position.y = 0.15; ringM.visible = false; g.add(ringM);
      const stars = new THREE.Group();
      for (let k = 0; k < 3; k++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0xfff27a })); st.userData.k = k; stars.add(st); }
      stars.position.y = 1.9; stars.visible = false; g.add(stars);
      sc.add(g); this.cubes.push({ g, body, lab, aura, ring: ringM, stars, yaw: blue ? 0 : Math.PI, x: 0, z: 0, scale: 1 });
    }
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_RADIUS, 32, 24), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.5 }));
    this.ball.castShadow = true; sc.add(this.ball);
    // ball trail
    this.trailN = 14; this.trailPts = [];
    this.trail = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.trailN * 3), 3)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    this.trail.frustumCulled = false; sc.add(this.trail);
    // effect pools
    this.bombObjs = []; this.mudObjs = [];
    this.previewRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.previewRing.rotation.x = -Math.PI / 2; this.previewRing.position.y = 0.06; this.previewRing.visible = false; sc.add(this.previewRing);
    this.previewDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    this.previewDisc.rotation.x = -Math.PI / 2; this.previewDisc.position.y = 0.05; this.previewDisc.visible = false; sc.add(this.previewDisc);
  }

  setGoalWidth(end, gw) {
    const g = this.goals[end]; g.cur = gw;
    g.posts[0].position.z = -gw; g.posts[1].position.z = gw;
    g.bar.scale.y = gw; g.net.scale.z = gw; g.edges.scale.z = gw; g.line.scale.y = gw;   // unit geometry is 2 long
    g.bar.scale.y = gw; g.line.scale.y = gw;
    g.net.scale.z = gw; g.edges.scale.z = gw;
  }

  bindInput() {
    const el = this.renderer.domElement; let drag = null;
    el.addEventListener('pointerdown', (e) => { if (this.camMode !== 'orbit' || this.preview) return; drag = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (this.preview) { const p = this.pickGround(e.clientX, e.clientY); this.movePreview(p); }
      if (!drag) return;
      this.orbit.yaw -= (e.clientX - drag[0]) * 0.006; this.orbit.pitch = Math.max(0.05, Math.min(1.5, this.orbit.pitch + (e.clientY - drag[1]) * 0.006));
      drag = [e.clientX, e.clientY];
    });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('wheel', (e) => { if (this.camMode !== 'orbit') return; e.preventDefault(); this.orbit.dist = Math.max(15, Math.min(160, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });
  }

  // world point under a screen position, on the ground plane (null if off-pitch)
  pickGround(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(v, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    if (Math.abs(hit.x) > HL + 4 || Math.abs(hit.z) > HW + 4) return null;
    return { x: hit.x, z: hit.z };
  }
  // radius < 0 / null hides the preview ring
  setPreview(p) { this.preview = p; if (!p) { this.previewRing.visible = false; this.previewDisc.visible = false; } else { this.previewRing.material.color.setHex(p.color); this.previewDisc.material.color.setHex(p.color); } }
  movePreview(pt) {
    if (!this.preview || !pt) { this.previewRing.visible = false; this.previewDisc.visible = false; return; }
    for (const m of [this.previewRing, this.previewDisc]) { m.visible = true; m.position.x = pt.x; m.position.z = pt.z; m.scale.set(this.preview.r, this.preview.r, 1); }
  }

  setCamera(id) {
    if (id === 'player' && this.camMode === 'player') this.playerCam = (this.playerCam + 1) % 4;
    this.camMode = id; this.snapCam = true; this.onCamera && this.onCamera(id, this.playerCam);
  }
  shake(a = 1) { this.shakeAmp = Math.max(this.shakeAmp, a); }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 450;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------- series / live data ----------
  prepMatch(m, series) {
    m.fps = m.fps || 20; m.events = m.events || []; m.fx = m.fx || [];
    m.goals = m.events.filter((e) => e.type === 'goal');
    m.kicks = new Map();
    m.evIdx = 0; m.fxIdx = 0; m.seen = false;
    if (m.complete === undefined) m.complete = true;
    for (const e of m.events) if (e.type === 'kick') { if (!m.kicks.has(e.f)) m.kicks.set(e.f, []); m.kicks.get(e.f).push(e.agent); }
    void series;
  }
  setSeries(series) {
    this.series = series;
    let t = 0;
    series.matches.forEach((m) => {
      this.prepMatch(m, series);
      m.duration = m.frames.length / m.fps;
      if (m.startOffset === undefined) m.startOffset = t;
      t = m.startOffset + m.duration + (series.gap ?? 6);
    });
    series.total = series.total ?? (t - (series.gap ?? 6));
    this.snapCam = true; this.prevBall = null; this.lastF = -1; this.lastMatch = -1;
  }
  // live: a match began
  addMatch(m) {
    m.frames = m.frames || []; m.complete = false; this.prepMatch(m, this.series);
    m.duration = m.frames.length / m.fps;
    this.series.matches[m.index ?? this.series.matches.length] = m;
  }
  appendFrame(mi, k, frame, events, fx) {
    const m = this.series && this.series.matches[mi]; if (!m) return;
    if (k === m.frames.length) m.frames.push(frame); else if (k < m.frames.length) m.frames[k] = frame; else return;   // gap: wait for snapshot
    m.duration = m.frames.length / m.fps;
    if (events) for (const e of events) { const o = { ...e, f: k }; m.events.push(o); if (e.type === 'goal') m.goals.push(o); if (e.type === 'kick') { if (!m.kicks.has(k)) m.kicks.set(k, []); m.kicks.get(k).push(e.agent); } }
    if (fx) m.fx.push({ f: k, s: fx });
  }

  locate(t) {
    const ms = this.series.matches;
    let i = 0;
    for (let k = 0; k < ms.length; k++) if (ms[k] && t >= ms[k].startOffset) i = k;
    const m = ms[i], local = Math.max(0, t - m.startOffset);
    const fpos = Math.max(0, Math.min(m.frames.length - 1, local * m.fps));
    return { i, m, local, fpos };
  }

  fxAt(m, f) {
    const list = m.fx; if (!list.length) return NOFX;
    if (m.fxIdx >= list.length || list[m.fxIdx].f > f) m.fxIdx = 0;
    while (m.fxIdx + 1 < list.length && list[m.fxIdx + 1].f <= f) m.fxIdx++;
    return list[m.fxIdx].f <= f ? list[m.fxIdx].s : NOFX;
  }

  fire(e) {
    if (e.type === 'kick') { this.flash[e.agent] = 1; }
    else if (e.type === 'explode') { this.spawnBlast(e.x, e.z); this.shake(1); }
    else if (e.type === 'goal') { this.goalFlash = 1; this.shake(0.5); }
    this.onEvent(e);
  }

  spawnBlast(x, z) {
    const ringM = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    ringM.rotation.x = -Math.PI / 2; ringM.position.set(x, 0.1, z);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9, depthWrite: false }));
    flash.position.set(x, 1, z);
    const N = 26, arr = new Float32Array(N * 3), vel = [];
    for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, s = 6 + Math.random() * 12; vel.push([Math.cos(a) * s, 6 + Math.random() * 10, Math.sin(a) * s]); arr[i * 3] = x; arr[i * 3 + 1] = 0.6; arr[i * 3 + 2] = z; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd27a, size: 0.45, transparent: true, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(ringM, flash, pts);
    this.blasts.push({ ring: ringM, flash, pts, vel, age: 0 });
  }
  updateBlasts(dt) {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]; b.age += dt; const k = b.age / 0.8;
      if (k >= 1) { this.scene.remove(b.ring, b.flash, b.pts); b.ring.geometry.dispose(); b.flash.geometry.dispose(); b.pts.geometry.dispose(); this.blasts.splice(i, 1); continue; }
      const r = C.BOMB_RADIUS * (1 - (1 - k) ** 3); b.ring.scale.set(r, r, 1); b.ring.material.opacity = 0.95 * (1 - k);
      const f = 1 + k * 3.5; b.flash.scale.set(f, f * 0.7, f); b.flash.material.opacity = 0.9 * (1 - k) ** 2;
      const a = b.pts.geometry.attributes.position;
      for (let j = 0; j < b.vel.length; j++) { b.vel[j][1] -= 25 * dt; a.array[j * 3] += b.vel[j][0] * dt; a.array[j * 3 + 1] = Math.max(0.1, a.array[j * 3 + 1] + b.vel[j][1] * dt); a.array[j * 3 + 2] += b.vel[j][2] * dt; }
      a.needsUpdate = true; b.pts.material.opacity = 1 - k;
    }
  }

  syncObjs(pool, count, make) { while (pool.length < count) { const o = make(); this.scene.add(o); pool.push(o); } pool.forEach((o, i) => { o.visible = i < count; }); }

  applyFx(fx, dt) {
    for (let e = 0; e < 2; e++) {
      const g = this.goals[e], target = fx.gw[e];
      const n = g.cur + (target - g.cur) * Math.min(1, dt * 7);
      if (Math.abs(n - g.cur) > 1e-3) this.setGoalWidth(e, n);
    }
    // bombs
    this.syncObjs(this.bombObjs, fx.bombs.length, () => {
      const grp = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 14), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.3, metalness: 0.6, emissive: 0x300000 }));
      ball.position.y = 0.65; ball.castShadow = true; grp.add(ball);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd34d })); spark.position.set(0.25, 1.35, 0); grp.add(spark);
      const ringM = new THREE.Mesh(new THREE.RingGeometry(C.BOMB_RADIUS - 0.18, C.BOMB_RADIUS, 56), new THREE.MeshBasicMaterial({ color: 0xff4433, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      ringM.rotation.x = -Math.PI / 2; ringM.position.y = 0.07; grp.add(ringM);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(C.BOMB_RADIUS, 56), new THREE.MeshBasicMaterial({ color: 0xff3322, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.06; grp.add(disc);
      grp.userData = { ball, spark, ringM, disc }; return grp;
    });
    fx.bombs.forEach(([x, z, fuse], i) => {
      const o = this.bombObjs[i], u = o.userData; o.position.set(x, 0, z);
      const freq = 3 + (1 - Math.min(1, fuse / C.BOMB_FUSE)) * 14, p = 0.5 + 0.5 * Math.sin(this.time * freq * 2);
      u.ringM.material.opacity = 0.35 + 0.6 * p; u.disc.material.opacity = 0.06 + 0.14 * p;
      const s = 1 + 0.12 * p; u.ball.scale.set(s, s, s); u.ball.material.emissive.setRGB(0.2 + 0.8 * p, 0, 0);
      u.spark.scale.setScalar(0.7 + p);
    });
    // mud pits
    this.syncObjs(this.mudObjs, fx.mud.length, () => {
      const grp = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(C.MUD_RADIUS, 48), new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 1, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; disc.receiveShadow = true; grp.add(disc);
      const rim = new THREE.Mesh(new THREE.RingGeometry(C.MUD_RADIUS - 0.25, C.MUD_RADIUS, 48), new THREE.MeshBasicMaterial({ color: 0x8b6a3d, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      rim.rotation.x = -Math.PI / 2; rim.position.y = 0.05; grp.add(rim);
      return grp;
    });
    fx.mud.forEach(([x, z], i) => this.mudObjs[i].position.set(x, 0, z));
  }

  // ---------- frame ----------
  frame(dt) {
    this.time += dt;
    if (!this.series || !this.series.matches.length) { this.renderer.render(this.scene, this.camera); return; }
    const t = this.getTime();
    const { i, m, local, fpos } = this.locate(t);
    if (!m.frames.length) { this.renderer.render(this.scene, this.camera); return; }
    const f0 = Math.floor(fpos), f1 = Math.min(m.frames.length - 1, f0 + 1), a = fpos - f0;
    const A = m.frames[f0], B = m.frames[f1], L = (k) => A[k] + (B[k] - A[k]) * a;

    // events crossed by the playhead
    if (this.lastMatch !== i) { this.lastMatch = i; this.lastF = -1; }
    if (!m.seen) { m.seen = true; m.evIdx = m.events.findIndex((e) => e.f > f0 - 0); if (m.evIdx < 0) m.evIdx = m.events.length; if (f0 <= 2) m.evIdx = 0; }
    if (f0 < this.lastF) { m.evIdx = m.events.findIndex((e) => e.f > f0); if (m.evIdx < 0) m.evIdx = m.events.length; }
    while (m.evIdx < m.events.length && m.events[m.evIdx].f <= f0) { const e = m.events[m.evIdx++]; if (f0 - e.f <= 6) this.fire(e); }
    this.lastF = f0;

    const fx = this.fxAt(m, f0); this.fxNow = fx;
    this.applyFx(fx, dt); this.updateBlasts(dt);

    const bx = L(0), by = L(1), bz = L(2);
    this.ball.position.set(bx, by, bz);
    if (this.prevBall) {
      const dx = bx - this.prevBall[0], dz = bz - this.prevBall[2];
      const d = Math.hypot(dx, dz);
      if (d > 1e-4 && d < 4) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz, 0, -dx).normalize(), d / C.BALL_RADIUS); this.ball.quaternion.premultiply(q); }
      const sp = d / Math.max(dt, 1e-3);
      this.trailPts.unshift([bx, by, bz]); if (this.trailPts.length > this.trailN) this.trailPts.pop();
      if (sp < 8 || d > 4) this.trailPts.length = Math.min(this.trailPts.length, 2);
    }
    this.prevBall = [bx, by, bz];
    const ta = this.trail.geometry.attributes.position;
    for (let k = 0; k < this.trailN; k++) { const p = this.trailPts[Math.min(k, this.trailPts.length - 1)] || [bx, by, bz]; ta.setXYZ(k, p[0], p[1], p[2]); }
    ta.needsUpdate = true;

    for (let k = 0; k < 4; k++) {
      const c = this.cubes[k], x = L(3 + k * 2), z = L(4 + k * 2);
      const vx = (x - c.x) / Math.max(dt, 1e-3), vz = (z - c.z) / Math.max(dt, 1e-3);
      if (Math.hypot(vx, vz) > 1.5 && Math.abs(x - c.x) < 3) { const want = Math.atan2(-vz, vx); let d = want - c.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); c.yaw += d * Math.min(1, dt * 10); }
      c.x = x; c.z = z; c.g.position.set(x, 0, z); c.g.rotation.y = c.yaw;
      // effect looks
      const bits = fx.cubes[k] || 0;
      let col = 0; for (const [bit, hex] of AURAS) if (bits & bit) { col = hex; break; }
      c.aura.visible = !!col; c.ring.visible = !!(bits & (1 | 8 | 16));
      if (col) { c.aura.material.color.setHex(col); c.aura.material.opacity = 0.16 + 0.1 * Math.sin(this.time * 8 + k); c.ring.material.color.setHex(col); c.ring.rotation.z += dt * ((bits & 8) ? -9 : 6); }
      const tgt = (bits & 4) ? 1.22 : 1; c.scale += (tgt - c.scale) * Math.min(1, dt * 10); c.body.scale.setScalar(c.scale); c.body.position.y = 0.75 * c.scale;
      c.stars.visible = !!(bits & 32); if (bits & 32) c.stars.children.forEach((s) => { const an = this.time * 7 + s.userData.k * 2.1; s.position.set(Math.cos(an) * 0.8, Math.sin(an * 1.7) * 0.1, Math.sin(an) * 0.8); });
    }
    for (let k = 0; k < 4; k++) { this.flash[k] = Math.max(0, this.flash[k] - dt * 5); this.cubes[k].body.material.emissive.setScalar(this.flash[k] * 0.55); }
    this.cubes.forEach((c, k) => { c.lab.visible = !(this.camMode === 'player' && k === this.playerCam); });
    this.goalFlash = Math.max(0, this.goalFlash - dt * 1.5);

    this.updateCamera(dt, bx, by, bz);
    this.renderer.render(this.scene, this.camera);

    // HUD info
    let score = [0, 0], lastGoal = null;
    for (const g of m.goals) if (g.f <= f0) { score = g.score; lastGoal = g; }
    const complete = m.complete !== false;
    const over = complete && local >= m.duration - 2.2;
    const lastMatch = complete && i === this.series.matches.length - 1 && this.series.finished === true;
    this.onHud({
      t, matchIndex: i, matches: this.series.matches.length, score, clock: A[11], overtime: !!A[12],
      goal: lastGoal && (f0 - lastGoal.f) / m.fps < 2.2 && !over ? lastGoal.team : -1,
      matchOver: over, matchResult: m, seriesOver: lastMatch && over, countdown: t < 0 ? -t : 0,
      wins: this.series.wins, total: this.series.total, winsSoFar: this.winsBefore(i, over), fx, live: !!this.series.live,
    });
  }

  winsBefore(i, includeCurrent) {
    const w = [0, 0];
    for (let k = 0; k < i + (includeCurrent ? 1 : 0); k++) { const m = this.series.matches[k]; if (m && m.winner >= 0) w[m.winner]++; }
    return w;
  }

  updateCamera(dt, bx, by, bz) {
    const want = new THREE.Vector3(), look = new THREE.Vector3(); let k = 4;
    const asp = this.camera.aspect;
    switch (this.camMode) {
      case 'top': want.set(0, 56 * Math.max(1, 1.5 / asp), 0.01); look.set(0, 0, 0); this.camera.up.set(0, 0, -1); k = 6; break;
      case 'ball': want.set(bx * 0.9, 9 + by * 0.5, bz + 15); look.set(bx, 0.5, bz); k = 3; break;
      case 'blueEnd': want.set(-HL - 14 * Math.max(1, 1.6 / asp), 12, 0); look.set(-8, 1, 0); break;
      case 'redEnd': want.set(HL + 14 * Math.max(1, 1.6 / asp), 12, 0); look.set(8, 1, 0); break;
      case 'player': {
        const c = this.cubes[this.playerCam];
        const dx = bx - c.x, dz = bz - c.z, d = Math.hypot(dx, dz) || 1;
        want.set(c.x - (dx / d) * 6, 4.2, c.z - (dz / d) * 6); look.set(bx, 0.8, bz); k = 5; break;
      }
      case 'orbit': {
        const o = this.orbit;
        want.set(Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, Math.sin(o.pitch) * o.dist, Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
        look.set(0, 0, 0); k = 12; break;
      }
      default: { const z = Math.max(1, 1.6 / asp); want.set(bx * 0.5, 26 * z, 40 * z); look.set(bx * 0.7, 0, 2); k = 3; }
    }
    if (this.camMode !== 'top') this.camera.up.set(0, 1, 0);
    const f = this.snapCam ? 1 : 1 - Math.exp(-k * dt);
    this.camPos.lerp(want, f); this.camLook.lerp(look, f); this.snapCam = false;
    this.camera.position.copy(this.camPos);
    if (this.shakeAmp > 0.01) { const s = this.shakeAmp * 0.6; this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s; this.camera.position.z += (Math.random() - 0.5) * s; this.shakeAmp *= Math.exp(-5 * dt); }
    this.camera.lookAt(this.camLook);
  }
}
