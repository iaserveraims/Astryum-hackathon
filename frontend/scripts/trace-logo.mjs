// trace-logo.mjs — regenera la geometría de Logo.tsx desde el PNG original.
//
// La marca en código es el TRAZADO PIXEL-FIEL del arte (v3, 2026-09-09):
// marching squares por capa de color (dorado/blanco/oscuro) sobre el PNG
// transparente + simplificación RDP de lazo cerrado. Si el arte cambia:
//   node frontend/scripts/trace-logo.mjs   (stdout: capas; stderr: piezas)
// y se pegan las piezas (stderr, JSON) en las constantes de ui/Logo.tsx.
// Gotchas pagados: la tabla de casos lleva el interior A LA IZQUIERDA
// (winding consistente o los lazos se parten en diagonal), y el RDP clásico
// anula lazos cerrados (primero==último) — se parte por el vértice más
// lejano y se simplifican las mitades.

// Trazado REAL del logo: marching squares por capa de color sobre el PNG
// transparente (700x700), cadena de segmentos → lazos cerrados → RDP.
import sharp from 'sharp';

const SRC = new URL('../public/astryum-mark-azul-transparente.png', import.meta.url).pathname;
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

const cls = new Uint8Array(W * H); // 0 fondo, 1 dorado(color), 2 blanco, 3 oscuro
for (let i = 0; i < W * H; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
  if (a < 128) continue;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  if (L < 90) cls[i] = 3;
  else if (sat < 40 && L > 190) cls[i] = 2;
  else cls[i] = 1;
}

function loopsOf(kind) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : cls[y * W + x] === kind ? 1 : 0);
  // marching squares sobre esquinas de celda; segmentos con puntos medios
  const segs = new Map(); // "x,y" inicio -> [ [ex,ey], ... ]
  const addSeg = (x1, y1, x2, y2) => {
    const k = `${x1},${y1}`;
    if (!segs.has(k)) segs.set(k, []);
    segs.get(k).push([x2, y2]);
  };
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const tl = at(x, y), tr = at(x + 1, y), bl = at(x, y + 1), br = at(x + 1, y + 1);
      const c = tl * 8 + tr * 4 + br * 2 + bl * 1;
      if (c === 0 || c === 15) continue;
      // puntos medios de los lados de la celda (cx,cy) = (x+1, y+1) centro
      const T = [x + 1, y + 0.5], B = [x + 1, y + 1.5], Lf = [x + 0.5, y + 1], R = [x + 1.5, y + 1];
      // segmentos orientados con el interior a la IZQUIERDA (winding consistente)
      const put = (p, q) => addSeg(p[0], p[1], q[0], q[1]);
      switch (c) {
        case 1: put(B, Lf); break;
        case 2: put(R, B); break;
        case 3: put(R, Lf); break;
        case 4: put(T, R); break;
        case 5: put(T, R); put(B, Lf); break; // silla
        case 6: put(T, B); break;
        case 7: put(T, Lf); break;
        case 8: put(Lf, T); break;
        case 9: put(B, T); break;
        case 10: put(Lf, T); put(R, B); break; // silla
        case 11: put(R, T); break;
        case 12: put(Lf, R); break;
        case 13: put(B, R); break;
        case 14: put(Lf, B); break;
      }
    }
  }
  // encadenar
  const loops = [];
  while (segs.size) {
    const [startKey, ends] = segs.entries().next().value;
    const [sx, sy] = startKey.split(',').map(Number);
    const pts = [[sx, sy]];
    let cur = ends.shift();
    if (!ends.length) segs.delete(startKey);
    while (cur) {
      pts.push(cur);
      if (cur[0] === sx && cur[1] === sy) break;
      const k = `${cur[0]},${cur[1]}`;
      const nx = segs.get(k);
      if (!nx) break;
      cur = nx.shift();
      if (!nx.length) segs.delete(k);
    }
    if (pts.length > 3) loops.push(pts);
  }
  return loops;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let dmax = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const area = (pts) => pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return s + (p[0] * q[1] - q[0] * p[1]);
}, 0) / 2;
const bbox = (pts) => pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [1e9, 1e9, -1e9, -1e9]);

const layers = { gold: loopsOf(1), white: loopsOf(2), dark: loopsOf(3) };
const all = [...layers.gold, ...layers.white, ...layers.dark].flat();
const gb = bbox(all);
// viewBox: bbox del arte + margen 6px, escalado a 132 por el lado largo
const M = 6;
const w = gb[2] - gb[0] + 2 * M, h = gb[3] - gb[1] + 2 * M;
const SC = 132 / Math.max(w, h);
const tx = (x) => +(((x - gb[0] + M) * SC).toFixed(1));
const ty = (y) => +(((y - gb[1] + M) * SC).toFixed(1));
// RDP de lazo CERRADO: primero==último anula toda distancia (la recta a-b es
// un punto). Se parte por el vértice más lejano al inicio y se simplifican
// las dos mitades.
function rdpClosed(loop, eps) {
  const pts = loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1]
    ? loop.slice(0, -1)
    : loop.slice();
  let far = 1, dmax = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > dmax) { dmax = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
const toPath = (loop) => 'M' + rdpClosed(loop, 1.35).map(([x, y]) => `${tx(x)} ${ty(y)}`).join('L') + 'Z';

const out = { viewW: +(w * SC).toFixed(1), viewH: +(h * SC).toFixed(1) };
for (const [name, loops] of Object.entries(layers)) {
  out[name] = loops
    .map((l) => ({ a: area(l), bb: bbox(l), d: toPath(l), n: l.length }))
    .filter((l) => Math.abs(l.a) > 60)
    .sort((x, y) => Math.abs(y.a) - Math.abs(x.a));
}
console.log(JSON.stringify(out, (k, v) => (k === 'bb' ? v.map(Math.round) : v)));

// ── clasificación de piezas para Logo.tsx ──
const G = out.gold, Wl = out.white, D = out.dark;
const ringLoops = G.slice(0, 2);
const trails = G.slice(2).sort((a, b) => a.bb[1] - b.bb[1]); // por altura
const face = Wl[0];
const craterHoles = Wl.slice(1).filter((l) => l.a > 0);
const sparkles = Wl.slice(1).filter((l) => l.a < 0);
const base = D[0];
// centro y radios del anillo, en coords de viewBox
const rc = ringLoops[0].bb;
const cx = tx((rc[0] + rc[2]) / 2), cy = ty((rc[1] + rc[3]) / 2);
const rOut = ((rc[2] - rc[0]) / 2) * SC;
const ri = ringLoops[1].bb;
const rIn = ((ri[2] - ri[0]) / 2) * SC;
console.error(JSON.stringify({
  viewW: out.viewW, viewH: out.viewH,
  center: { x: +cx.toFixed(1), y: +cy.toFixed(1) },
  ringMid: +((rOut + rIn) / 2).toFixed(1),
  ringW: +(rOut - rIn + 1).toFixed(1),
  ring: ringLoops.map((l) => l.d).join(''),
  trails: trails.map((l) => l.d),
  base: base.d,
  face: face.d,
  craters: craterHoles.map((l) => l.d),
  sparkles: sparkles.map((l) => l.d),
}));
