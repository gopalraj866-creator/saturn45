import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------ *
 *  Query params
 *    ?capture=1        -> deterministic mode used by the CI renderer
 *    ?duration=90      -> length of one seamless camera loop (seconds)
 *    ?label=LIVE       -> text for the live badge (top right)
 *    ?free=1           -> OrbitControls instead of the cinematic path
 *    ?bloom=0          -> disable bloom
 * ------------------------------------------------------------------ */
const q = new URLSearchParams(location.search);
const CAPTURE = q.has('capture');
const DURATION = +q.get('duration') || 90;
const LABEL = q.get('label') || '';
const FREE = q.has('free');
const BLOOM = q.get('bloom') !== '0';

/* Real-world proportions (Saturn equatorial radius = 1 unit) */
const FLATTENING = 0.902;          // polar / equatorial radius
const RING_IN = 1.236;             // D ring inner edge  (~74,500 km)
const RING_OUT = 2.327;            // F ring             (~140,200 km)
const SUN_DIR = new THREE.Vector3(0.743, 0.242, 0.624).normalize();

/* ------------------------------------------------------------------ *
 *  Renderer
 * ------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.02, 2000);

/* ------------------------------------------------------------------ *
 *  Textures (real ones from /web/textures, procedural fallback)
 * ------------------------------------------------------------------ */
const loader = new THREE.TextureLoader();
const status = { saturn: false, ring: false, stars: false };

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function fallbackSaturn() {
  const rnd = mulberry32(7), w = 2048, h = 1024;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const pal = [[201,166,107],[227,207,156],[176,138,82],[214,190,134],[160,124,74]];
  let k = 0;
  for (let y = 0; y < h; y++) {
    if (rnd() < 0.05) k = Math.floor(rnd() * pal.length);
    const lat = Math.abs(y / h - 0.5) * 2;
    const a = pal[k], b = pal[(k + 1) % pal.length], m = 0.5 + 0.5 * Math.sin(y * 0.09 + rnd());
    const dim = 1 - 0.25 * lat;
    g.fillStyle = `rgb(${(a[0]*m+b[0]*(1-m))*dim|0},${(a[1]*m+b[1]*(1-m))*dim|0},${(a[2]*m+b[2]*(1-m))*dim|0})`;
    g.fillRect(0, y, w, 1);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function fallbackRing() {
  const w = 2048, h = 4, d = new Uint8Array(w * h * 4), rnd = mulberry32(3);
  for (let x = 0; x < w; x++) {
    const r = x / (w - 1);
    let dens = r < 0.2 ? 0.18 : r < 0.55 ? 0.92 : r < 0.6 ? 0.04 : r < 0.93 ? 0.62 : r < 0.945 ? 0.05 : r < 0.96 ? 0.55 : 0.0;
    dens *= 0.75 + 0.25 * Math.sin(x * 0.7) * Math.sin(x * 0.13 + rnd());
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4; d[i] = 205; d[i+1] = 185; d[i+2] = 150; d[i+3] = Math.max(0, Math.min(255, dens * 255));
    }
  }
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
}

async function getTexture(url, key, fallback) {
  try {
    const t = await loader.loadAsync(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    status[key] = true;
    return t;
  } catch (e) {
    console.warn(`texture "${url}" missing -> procedural fallback`);
    return fallback ? fallback() : null;
  }
}

const [saturnMap, ringMap, starsMap] = await Promise.all([
  getTexture('./textures/saturn.jpg', 'saturn', fallbackSaturn),
  getTexture('./textures/saturn_ring_alpha.png', 'ring', fallbackRing),
  getTexture('./textures/stars_milky_way.jpg', 'stars', null),
]);
ringMap.wrapS = THREE.ClampToEdgeWrapping;
ringMap.wrapT = THREE.ClampToEdgeWrapping;
window.__textures = status;

/* ------------------------------------------------------------------ *
 *  Sky
 * ------------------------------------------------------------------ */
if (starsMap) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 64, 32),
    new THREE.MeshBasicMaterial({ map: starsMap, side: THREE.BackSide, depthWrite: false, color: 0xb8b8c0 })
  );
  sky.rotation.set(0.45, 1.2, 0.2);
  scene.add(sky);
} else {
  const rnd = mulberry32(42), n = 9000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 800;
    pos.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3);
    const b = 0.35 + 0.65 * Math.pow(rnd(), 3), tint = rnd();
    col.set([b * (0.85 + 0.15 * tint), b * 0.9, b * (1 - 0.2 * tint)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
}

/* ------------------------------------------------------------------ *
 *  Saturn globe  (oblate, with ring shadow cast onto the clouds)
 * ------------------------------------------------------------------ */
const sunUniform = { value: SUN_DIR.clone() };
const sunPower = { value: 1.35 };

const saturnMat = new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: saturnMap }, uRing: { value: ringMap }, uSun: sunUniform,
    uRi: { value: RING_IN }, uRo: { value: RING_OUT }, uPower: sunPower,
  },
  vertexShader: /* glsl */`
    varying vec3 vN; varying vec3 vWP; varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWP = wp.xyz;
      vN = normalize(mat3(transpose(inverse(modelMatrix))) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap; uniform sampler2D uRing;
    uniform vec3 uSun; uniform float uRi; uniform float uRo; uniform float uPower;
    varying vec3 vN; varying vec3 vWP; varying vec2 vUv;
    void main() {
      vec3 N = normalize(vN), L = normalize(uSun), V = normalize(cameraPosition - vWP);
      float ndl = dot(N, L);
      float lit = pow(clamp((ndl + 0.07) / 1.07, 0.0, 1.0), 1.12);

      // shadow of the rings on the planet
      float sh = 1.0;
      if (abs(L.y) > 1e-4) {
        float t = -vWP.y / L.y;
        if (t > 0.0) {
          vec3 h = vWP + L * t;
          float r = length(h.xz);
          if (r > uRi && r < uRo) {
            float a = texture2D(uRing, vec2((r - uRi) / (uRo - uRi), 0.5)).a;
            sh = 1.0 - 0.93 * a;
          }
        }
      }

      vec3 albedo = texture2D(uMap, vUv).rgb;
      float ndv = max(dot(N, V), 0.0);
      float limb = mix(0.55, 1.0, pow(ndv, 0.45));
      vec3 col = albedo * (uPower * lit * sh * limb + 0.010);

      // thin atmosphere glow on the lit limb
      float rim = pow(1.0 - ndv, 3.0);
      col += vec3(1.0, 0.82, 0.55) * rim * 0.20 * clamp(ndl + 0.35, 0.0, 1.0) * sh;

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

const saturn = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 160), saturnMat);
saturn.scale.set(1, FLATTENING, 1);
scene.add(saturn);

/* ------------------------------------------------------------------ *
 *  Rings  (radial texture, planet shadow on rings, backlit transmission)
 * ------------------------------------------------------------------ */
const ringGeo = new THREE.RingGeometry(RING_IN, RING_OUT, 360, 1);
ringGeo.rotateX(-Math.PI / 2);
const ringMat = new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: ringMap }, uSun: sunUniform, uRi: { value: RING_IN }, uRo: { value: RING_OUT },
    uFlat: { value: FLATTENING }, uPower: sunPower,
  },
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    varying vec3 vWP;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap; uniform vec3 uSun;
    uniform float uRi; uniform float uRo; uniform float uFlat; uniform float uPower;
    varying vec3 vWP;
    void main() {
      float r = length(vWP.xz);
      float u = clamp((r - uRi) / (uRo - uRi), 0.0, 1.0);
      vec4 tx = texture2D(uMap, vec2(u, 0.5));
      vec3 L = normalize(uSun), V = normalize(cameraPosition - vWP);

      // viewer on the sunlit side -> reflected light; otherwise light filters through the rings
      bool sameSide = (V.y * L.y) > 0.0;
      float a = tx.a;
      float fs = pow(max(dot(-V, L), 0.0), 6.0);                 // forward scattering
      float bright = sameSide ? 1.0 : (0.16 + 0.60 * (1.0 - a) + 1.3 * fs * (1.0 - a));

      // Saturn's shadow falling on the rings (ellipsoid test)
      vec3 p = vWP * vec3(1.0, 1.0 / uFlat, 1.0);
      vec3 l = L   * vec3(1.0, 1.0 / uFlat, 1.0);
      float A = dot(l, l), B = dot(p, l), C = dot(p, p) - 1.0;
      float disc = B * B - A * C;
      float sh = (B < 0.0 && disc > 0.0) ? smoothstep(0.0, 0.05, disc / A) : 0.0;
      bright *= mix(1.0, 0.03, sh);

      gl_FragColor = vec4(tx.rgb * bright * uPower, a * 0.98);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const rings = new THREE.Mesh(ringGeo, ringMat);
rings.renderOrder = 2;
scene.add(rings);

/* Sun glare (visible in the backlit shots) */
{
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.08, 'rgba(255,240,205,0.9)');
  gr.addColorStop(0.3, 'rgba(255,200,130,0.25)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  sun.scale.setScalar(70);
  scene.add(sun);
}

/* ------------------------------------------------------------------ *
 *  Post-processing
 * ------------------------------------------------------------------ */
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
if (BLOOM) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.8, 0.92));
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ *
 *  Cinematic camera: one seamless loop, many angles
 *  (position + look-at waypoints, planet radius = 1)
 * ------------------------------------------------------------------ */
const WP = [
  // position              target               fov   caption
  [[ 6.5,  1.6,  7.5], [ 0.0,  0.0,  0.0], 38, 'The ringed jewel of the Solar System'],
  [[ 0.9,  0.5,  2.0], [-0.6,  0.15, 0.2], 44, 'Skimming above the rings: ice from dust grains to boulders'],
  [[-2.2,  1.4,  4.6], [ 0.0,  0.0,  0.0], 36, 'Equatorial diameter \u2248 120,500 km \u2014 about 9.4\u00d7 Earth'],
  [[-5.5,  0.18, 3.0], [ 0.0,  0.0,  0.0], 34, 'Edge-on, the main rings are razor thin \u2014 often only ~10 m'],
  [[-6.5,  1.2, -1.5], [ 0.0,  0.0,  0.0], 36, 'Density 0.69 g/cm\u00b3 \u2014 less dense than water'],
  [[-5.2,  1.6, -5.2], [ 0.0,  0.0,  0.0], 34, 'Backlit: sunlight filters through the rings, the Cassini Division glows'],
  [[-1.0,  6.8, -2.0], [ 0.0,  0.0,  0.0], 38, 'North pole: a hexagonal jet stream \u2248 30,000 km across'],
  [[ 3.0,  1.0, -4.8], [ 0.0,  0.0,  0.0], 36, 'One day \u2248 10 h 33 m \u2014 one year \u2248 29.4 Earth years'],
  [[ 5.2, -2.0, -1.0], [ 0.0,  0.0,  0.0], 38, 'Winds near the equator reach \u2248 1,800 km/h'],
  [[ 6.4,  0.5,  3.6], [ 0.0,  0.0,  0.0], 38, 'Cassini studied Saturn for 13 years, until 2017'],
];
const N = WP.length;
const camCurve = new THREE.CatmullRomCurve3(WP.map(w => new THREE.Vector3(...w[0])), true, 'centripetal');
const tgtCurve = new THREE.CatmullRomCurve3(WP.map(w => new THREE.Vector3(...w[1])), true, 'centripetal');
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const capEl = document.getElementById('cap');
const liveEl = document.getElementById('live');
if (LABEL) { liveEl.style.display = 'flex'; document.getElementById('livetxt').textContent = LABEL; }

const tmpPos = new THREE.Vector3(), tmpTgt = new THREE.Vector3();
function setTime(t) {
  const u = ((t % DURATION) + DURATION) % DURATION / DURATION;

  saturn.rotation.y = u * Math.PI * 2;                // one full turn per loop -> seamless

  if (!FREE) {
    camCurve.getPoint(u, tmpPos);
    tgtCurve.getPoint(u, tmpTgt);
    const s = u * N, i = Math.floor(s) % N, f = s - Math.floor(s);
    camera.fov = WP[i][2] + (WP[(i + 1) % N][2] - WP[i][2]) * smooth(0, 1, f);
    camera.updateProjectionMatrix();

    // gentle handheld drift (integer cycles per loop)
    tmpPos.x += 0.012 * Math.sin(u * Math.PI * 2 * 7);
    tmpPos.y += 0.010 * Math.sin(u * Math.PI * 2 * 11);
    camera.position.copy(tmpPos);
    camera.lookAt(tmpTgt);

    const op = smooth(0, 0.1, f) * (1 - smooth(0.86, 1, f));
    capEl.textContent = WP[i][3];
    capEl.style.opacity = op.toFixed(3);
    capEl.style.transform = `translateY(${((1 - op) * 1.2).toFixed(2)}vh)`;
  }
  composer.render();
}

/* ------------------------------------------------------------------ *
 *  Run
 * ------------------------------------------------------------------ */
addEventListener('resize', () => {
  if (CAPTURE) return;
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

camera.position.set(6.5, 1.6, 7.5);
camera.lookAt(0, 0, 0);

if (CAPTURE) {
  window.__setTime = async (t) => {
    setTime(t);
    await new Promise(r => requestAnimationFrame(() => r()));
  };
  window.__ready = true;
} else {
  let controls = null;
  if (FREE) { controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = 1.5; }
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    if (controls) controls.update();
    setTime(clock.getElapsedTime());
  });
  window.__ready = true;
}
