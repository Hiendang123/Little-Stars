(() => {
  "use strict";

  // Optional small caption under the heart after Phase 2.
  // Leave as "" or "[CAPTION]" to render no text.
  const CAPTION = "";

  // Ultra-dense particle budget (~111,260 3D elements)
  const HEART_COUNT = 26000;
  const GALAXY_STAR_COUNT = 80000;
  const SKY_STAR_COUNT = 5000;
  const GALAXY_MIST_COUNT = 260;

  // Saturated Ruby / Hot-Pink RGB palette
  const HEART_RGB = [
    [255, 28, 108],  // Vibrant hot ruby-pink
    [255, 58, 136],  // Luminous rose neon
    [230, 12, 88],   // Deep crimson-magenta contour depth
    [255, 118, 172]  // Soft pink highlight sparks
  ];
  const HEART_COLOR_WEIGHTS = [0.38, 0.26, 0.24, 0.12];

  // Andromeda Spiral Galaxy RGB palette
  const GALAXY_RGB = [
    [255, 168, 210], // 0: Soft rose-pink inner transition
    [255, 224, 192], // 1: Warm cream-gold inner ring
    [244, 249, 255], // 2: Diamond silver-white starlight
    [168, 214, 255], // 3: Brilliant Andromeda ice-blue
    [90, 156, 255],  // 4: Vibrant sapphire spiral arm
    [50, 106, 206]   // 5: Deep cosmic outer disk blue
  ];

  // Timeline & rhythm constants
  const PHASE_CLOUD_END = 1.5;
  const PHASE_WEAVE_END = 5.0;
  const BEAT_BPM = 72;
  const BEAT_PERIOD = 60 / BEAT_BPM; // ~0.8333s per lub-dub cycle
  const CONTOUR_LAP_SECONDS = 40.0;
  const GALAXY_SPIN_SPEED = 0.046;
  const RIPPLE_DURATION = 1.25;
  const MAX_RIPPLES = 2;
  const RIPPLE_SEGMENTS = 120;

  // Arc-length lookup table size (eliminates vertical center column / cusp bunching 100%!)
  const ARC_TABLE_SIZE = 4096;
  const arcTableT = new Float32Array(ARC_TABLE_SIZE + 1);

  // 3D Orbit Camera constants (horizontal galaxy at roll = 0, ~22° elevation)
  const CAM_BASE_DIST = 3.30;
  const INITIAL_YAW = 0.0;
  const INITIAL_PITCH = 0.385;
  const MIN_ZOOM = 0.58;
  const MAX_ZOOM = 2.05;

  const MIST_SIZE_BUCKETS = [13.0, 21.0, 31.0];
  const MIST_ALPHA_STEPS = 6;

  const TWINKLE_MASK = 255;
  const twinkleLUT = new Float32Array(256);
  const twinkleFreqLUT = new Float32Array(256);
  const twinklePhaseLUT = new Float32Array(256);

  // Underdamped spring constants for 3D center-to-edge heartbeat wave
  const SPRING_K = 210;
  const SPRING_DAMP = 21;
  const SPRING_PEAK_VEL_GAIN = 32.2;

  const TAU = Math.PI * 2;
  const HEART_FOCUS_Y = -1.5;

  const rootStyle = document.documentElement.style;
  const bgCanvas = document.getElementById("bg-canvas");
  const heartCanvas = document.getElementById("heart-canvas");
  const bgCtx = bgCanvas.getContext("2d");
  const heartCtx = heartCanvas.getContext("2d", { alpha: false });
  const heartTextEl = document.getElementById("heart-text");
  const captionEl = document.getElementById("caption");

  let heartTextShown = false;
  const hasCaption = Boolean(CAPTION && CAPTION.trim() && CAPTION.trim() !== "[CAPTION]");
  let captionShown = false;
  if (hasCaption && captionEl) {
    captionEl.textContent = CAPTION.trim();
    captionEl.hidden = false;
  }

  // Offscreen Direct Pixel Buffer
  const rasterCanvas = document.createElement("canvas");
  const rasterCtx = rasterCanvas.getContext("2d", { alpha: false });
  let rasterW = 1;
  let rasterH = 1;
  let rasterScale = 1;
  let imgData = null;
  let pix8 = null;
  let pix32 = null;

  // Viewport & DPR state
  let vw = 0;
  let vh = 0;
  let dpr = 1;
  let lastMistDpr = 0;
  let minDim = 0;
  let heartBaseScale = 0;

  // Interactive 360° Orbit Camera state
  let camYaw = INITIAL_YAW;
  let camPitch = INITIAL_PITCH;
  let velYaw = 0;
  let velPitch = 0;
  let zoom = 1.0;
  let targetZoom = 1.0;

  const activePointers = new Map();
  let isDragging = false;
  let lastDragX = 0;
  let lastDragY = 0;
  let lastPinchDist = 0;

  let mistSprites = [];
  let mistSpriteHalf = [];

  // Exact parametric heart metrics
  let heartYMid = 0;
  let heartYSpan = 1;
  let maxHeartNormDist = 0.58;

  const galColorR = new Uint8Array(GALAXY_RGB.length);
  const galColorG = new Uint8Array(GALAXY_RGB.length);
  const galColorB = new Uint8Array(GALAXY_RGB.length);
  for (let i = 0; i < GALAXY_RGB.length; i++) {
    galColorR[i] = GALAXY_RGB[i][0];
    galColorG[i] = GALAXY_RGB[i][1];
    galColorB[i] = GALAXY_RGB[i][2];
  }

  const heartColorR = new Uint8Array(HEART_RGB.length);
  const heartColorG = new Uint8Array(HEART_RGB.length);
  const heartColorB = new Uint8Array(HEART_RGB.length);
  for (let i = 0; i < HEART_RGB.length; i++) {
    heartColorR[i] = HEART_RGB[i][0];
    heartColorG[i] = HEART_RGB[i][1];
    heartColorB[i] = HEART_RGB[i][2];
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function evalParametricHeart(t) {
    const s = Math.sin(t);
    const c = Math.cos(t);
    const x = 16 * s * s * s;
    const c2 = 2 * c * c - 1;
    const c3 = 4 * c * c * c - 3 * c;
    const c4 = 2 * c2 * c2 - 1;
    const y = 13 * c - 5 * c2 - 2 * c3 - c4;
    return { x, y };
  }

  // Build exact Arc-Length lookup table so contour particles distribute with 100% uniform
  // linear density — completely eliminating any vertical center column at t=0 and t=π!
  function computeHeartBoundsAndArcTable() {
    const fineSteps = 16384;
    const cumArc = new Float64Array(fineSteps + 1);
    let minY = Infinity;
    let maxY = -Infinity;

    let prev = evalParametricHeart(0);
    minY = prev.y;
    maxY = prev.y;
    cumArc[0] = 0;

    for (let i = 1; i <= fineSteps; i++) {
      const t = (i / fineSteps) * TAU;
      const cur = evalParametricHeart(t);
      if (cur.y < minY) minY = cur.y;
      if (cur.y > maxY) maxY = cur.y;

      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      cumArc[i] = cumArc[i - 1] + Math.hypot(dx, dy);
      prev = cur;
    }

    heartYMid = (maxY + minY) * 0.5;
    heartYSpan = maxY - minY;

    const totalLen = cumArc[fineSteps];
    let searchIdx = 0;
    arcTableT[0] = 0;
    for (let k = 1; k < ARC_TABLE_SIZE; k++) {
      const targetLen = (k / ARC_TABLE_SIZE) * totalLen;
      while (searchIdx < fineSteps && cumArc[searchIdx + 1] < targetLen) {
        searchIdx++;
      }
      const segStart = cumArc[searchIdx];
      const segSpan = cumArc[searchIdx + 1] - segStart;
      const frac = segSpan > 1e-9 ? (targetLen - segStart) / segSpan : 0;
      arcTableT[k] = ((searchIdx + frac) / fineSteps) * TAU;
    }
    arcTableT[ARC_TABLE_SIZE] = TAU;

    let maxD = 0;
    for (let i = 0; i < 360; i++) {
      const t = (i / 360) * TAU;
      const { x, y } = evalParametricHeart(t);
      const wx = x / heartYSpan;
      const wy = (y - heartYMid) / heartYSpan;
      const d = Math.hypot(wx, wy);
      if (d > maxD) maxD = d;
    }
    maxHeartNormDist = maxD || 0.58;
  }

  // Fast O(1) interpolated lookup from normalized arc-length s in [0, 1) -> parametric angle t
  function arcFractionToT(s) {
    let wrapped = s - Math.floor(s);
    if (wrapped < 0) wrapped += 1;
    const pos = wrapped * ARC_TABLE_SIZE;
    const idx = pos | 0;
    const frac = pos - idx;
    return arcTableT[idx] + (arcTableT[idx + 1] - arcTableT[idx]) * frac;
  }

  function pickWeightedHeartColor() {
    const r = Math.random();
    let acc = 0;
    for (let i = 0; i < HEART_COLOR_WEIGHTS.length; i++) {
      acc += HEART_COLOR_WEIGHTS[i];
      if (r <= acc) return i;
    }
    return 0;
  }

  function randBell() {
    return (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
  }

  function initTwinkleTable() {
    for (let i = 0; i < 256; i++) {
      twinkleFreqLUT[i] = 0.9 + Math.random() * 2.6;
      twinklePhaseLUT[i] = Math.random() * TAU;
      twinkleLUT[i] = 1.0;
    }
  }

  function updateTwinkleTable() {
    if (prefersReducedMotion) {
      twinkleLUT.fill(0.92);
      return;
    }
    for (let i = 0; i < 256; i++) {
      twinkleLUT[i] = 0.72 + 0.28 * Math.sin(elapsed * twinkleFreqLUT[i] + twinklePhaseLUT[i]);
    }
  }

  function buildMistSprites(currentDpr) {
    mistSprites = [];
    mistSpriteHalf = [];
    for (let sIdx = 0; sIdx < MIST_SIZE_BUCKETS.length; sIdx++) {
      const radiusPhys = MIST_SIZE_BUCKETS[sIdx] * 0.5 * currentDpr;
      const dim = Math.max(8, Math.ceil(radiusPhys * 2 + 2));
      mistSpriteHalf[sIdx] = dim * 0.5;
    }

    for (let cIdx = 0; cIdx < GALAXY_RGB.length; cIdx++) {
      const [r, g, b] = GALAXY_RGB[cIdx];
      const colorArr = [];
      for (let sIdx = 0; sIdx < MIST_SIZE_BUCKETS.length; sIdx++) {
        const radiusPhys = MIST_SIZE_BUCKETS[sIdx] * 0.5 * currentDpr;
        const half = mistSpriteHalf[sIdx];
        const dim = half * 2;
        const sizeArr = [];

        for (let aIdx = 0; aIdx < MIST_ALPHA_STEPS; aIdx++) {
          const alpha = 0.018 + (aIdx / (MIST_ALPHA_STEPS - 1)) * 0.055;
          const off = document.createElement("canvas");
          off.width = dim;
          off.height = dim;
          const octx = off.getContext("2d");

          const grad = octx.createRadialGradient(half, half, 0, half, half, radiusPhys);
          grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(4)})`);
          grad.addColorStop(0.52, `rgba(${r}, ${g}, ${b}, ${(alpha * 0.48).toFixed(4)})`);
          grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

          octx.fillStyle = grad;
          octx.beginPath();
          octx.arc(half, half, radiusPhys, 0, TAU);
          octx.fill();
          sizeArr.push(off);
        }
        colorArr.push(sizeArr);
      }
      mistSprites.push(colorArr);
    }
  }

  // --- 360° DEEP-SPACE STARFIELD (5,000 stars) ---
  const skyWx = new Float32Array(SKY_STAR_COUNT);
  const skyWy = new Float32Array(SKY_STAR_COUNT);
  const skyWz = new Float32Array(SKY_STAR_COUNT);
  const skyBright = new Float32Array(SKY_STAR_COUNT);
  const skyColor = new Uint8Array(SKY_STAR_COUNT);
  const skyKind = new Uint8Array(SKY_STAR_COUNT);

  function initSkyStars() {
    for (let i = 0; i < SKY_STAR_COUNT; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * TAU;
      const root = Math.sqrt(1 - u * u);
      const radius = 4.3 + Math.random() * 3.0;

      skyWx[i] = radius * root * Math.cos(phi);
      skyWy[i] = radius * u;
      skyWz[i] = radius * root * Math.sin(phi);

      const roll = Math.random();
      if (roll < 0.72) {
        skyKind[i] = 0;
        skyBright[i] = 0.26 + Math.random() * 0.42;
      } else if (roll < 0.91) {
        skyKind[i] = 1;
        skyBright[i] = 0.42 + Math.random() * 0.44;
      } else {
        skyKind[i] = 2;
        skyBright[i] = 0.66 + Math.random() * 0.32;
      }

      const cRand = Math.random();
      skyColor[i] = cRand < 0.54 ? 2 : (cRand < 0.80 ? 3 : (cRand < 0.92 ? 1 : 4));
    }
  }

  // --- 80,000-STAR HORIZONTAL SPIRAL GALAXY WITH SPACIOUS CENTRAL EYE FOR THE HEART ---
  const galGx = new Float32Array(GALAXY_STAR_COUNT);
  const galGy = new Float32Array(GALAXY_STAR_COUNT);
  const galGz = new Float32Array(GALAXY_STAR_COUNT);
  const galBright = new Float32Array(GALAXY_STAR_COUNT);
  const galColor = new Uint8Array(GALAXY_STAR_COUNT);
  const galKind = new Uint8Array(GALAXY_STAR_COUNT);
  const galInnerWeight = new Float32Array(GALAXY_STAR_COUNT);

  const mistGx = new Float32Array(GALAXY_MIST_COUNT);
  const mistGy = new Float32Array(GALAXY_MIST_COUNT);
  const mistGz = new Float32Array(GALAXY_MIST_COUNT);
  const mistAlpha = new Float32Array(GALAXY_MIST_COUNT);
  const mistColor = new Uint8Array(GALAXY_MIST_COUNT);
  const mistSize = new Uint8Array(GALAXY_MIST_COUNT);

  function pickGalaxyColorByRadius(normR) {
    const nr = Math.max(0, Math.min(1, normR + (Math.random() - 0.5) * 0.16));
    if (nr < 0.10) return Math.random() < 0.58 ? 0 : 1;
    if (nr < 0.28) return Math.random() < 0.48 ? 1 : 2;
    if (nr < 0.54) return Math.random() < 0.48 ? 2 : 3;
    if (nr < 0.78) return Math.random() < 0.56 ? 3 : 4;
    return Math.random() < 0.48 ? 4 : 5;
  }

  function initGalaxy() {
    const innerSanctuaryR = 0.58;
    const maxR = 2.12;
    const spiralWinding = 4.25;

    for (let i = 0; i < GALAXY_STAR_COUNT; i++) {
      const u = i / GALAXY_STAR_COUNT;
      let r;
      let theta;
      let y;
      let brightness;
      let kind = 0;

      if (u < 0.018) {
        // Subtle transition stardust outside the hollow heart interior (r = 0.48 -> 0.64)
        const p = Math.pow(Math.random(), 0.75);
        r = 0.48 + p * 0.18;
        theta = Math.random() * TAU;
        y = randBell() * 0.06;
        brightness = 0.12 + p * 0.15;
        kind = 0;
      } else if (u < 0.38) {
        // Full-Disk Diamond Sand Carpet outside the Heart
        const p = Math.pow(Math.random(), 0.96);
        r = innerSanctuaryR + p * (maxR * 1.03 - innerSanctuaryR);
        const ringWave = Math.sin(r * 13.0) * 0.18;
        theta = Math.random() * TAU + ringWave;

        const normR = (r - innerSanctuaryR) / (maxR - innerSanctuaryR);
        const innerFade = smoothstep(0.56, 0.85, r);
        const thickness = 0.052 * (1 - normR * 0.46);
        y = randBell() * thickness;

        brightness = (0.34 + Math.random() * 0.38) * innerFade * (1 - normR * 0.26);
        kind = Math.random() < 0.80 ? 0 : 1;
      } else if (u < 0.958) {
        // 4 Super-Dense Spiral Arms & Andromeda Rings
        const isPrimaryArm = Math.random() < 0.68;
        const armIndex = isPrimaryArm
          ? (Math.random() < 0.5 ? 0 : 2)
          : (Math.random() < 0.5 ? 1 : 3);
        const armBase = armIndex * (Math.PI * 0.5);

        const p = Math.pow(Math.random(), 0.88);
        r = innerSanctuaryR + p * (maxR - innerSanctuaryR);
        const normR = (r - innerSanctuaryR) / (maxR - innerSanctuaryR);
        const innerFade = smoothstep(0.55, 0.83, r);

        const baseSpiralAngle = armBase + spiralWinding * Math.log(1 + r * 1.85);
        const armWidth = (isPrimaryArm ? 0.18 : 0.26) + normR * 0.20;
        let offsetAngle = randBell() * armWidth;

        if (isPrimaryArm && offsetAngle > -0.14 && offsetAngle < -0.03 && Math.random() < 0.65) {
          offsetAngle = Math.abs(offsetAngle) + 0.015;
        }

        theta = baseSpiralAngle + offsetAngle;
        const diskThickness = 0.042 * (1 - normR * 0.50);
        y = randBell() * diskThickness;

        const ridgeFactor = Math.max(0, 1 - Math.abs(offsetAngle) / armWidth);
        brightness = (0.38 + ridgeFactor * 0.48 + Math.random() * 0.12) * innerFade * (1 - normR * 0.24);
        kind = Math.random() < 0.74 ? 0 : 1;
      } else {
        // Brilliant Diamond Star Crosses along outer spiral arms
        const inArm = Math.random() < 0.85;
        if (inArm) {
          const armBase = ((Math.random() * 4) | 0) * (Math.PI * 0.5);
          const p = Math.pow(Math.random(), 0.86);
          r = 0.65 + p * (maxR * 1.02 - 0.65);
          theta = armBase + spiralWinding * Math.log(1 + r * 1.85) + randBell() * 0.26;
          y = randBell() * 0.044;
        } else {
          r = 0.68 + Math.random() * (maxR * 1.15 - 0.68);
          theta = Math.random() * TAU;
          y = randBell() * 0.20;
        }
        brightness = 0.72 + Math.random() * 0.28;
        kind = 2;
      }

      const normR = Math.max(0, Math.min(1, (r - innerSanctuaryR) / (maxR - innerSanctuaryR)));
      galGx[i] = r * Math.cos(theta);
      galGy[i] = y;
      galGz[i] = r * Math.sin(theta);
      galBright[i] = brightness;
      galKind[i] = kind;
      galColor[i] = kind === 2 && Math.random() < 0.50 ? 2 : pickGalaxyColorByRadius(normR);
      galInnerWeight[i] = Math.max(0, 1 - normR * 3.0);
    }

    for (let i = 0; i < GALAXY_MIST_COUNT; i++) {
      let r;
      let theta;
      let y;

      if (i < 190) {
        const armBase = (i % 4) * (Math.PI * 0.5);
        const p = Math.random();
        r = 0.68 + p * (maxR * 0.96 - 0.68);
        theta = armBase + spiralWinding * Math.log(1 + r * 1.85) + randBell() * 0.25;
        y = randBell() * 0.035;
        const normR = (r - innerSanctuaryR) / (maxR - innerSanctuaryR);
        mistColor[i] = pickGalaxyColorByRadius(normR);
        mistSize[i] = Math.random() < 0.35 ? 0 : (Math.random() < 0.72 ? 1 : 2);
        mistAlpha[i] = (0.022 + Math.random() * 0.028) * smoothstep(0.66, 0.92, r) * (1 - normR * 0.30);
      } else {
        const p = Math.random();
        r = 0.72 + p * (maxR * 0.92 - 0.72);
        theta = Math.random() * TAU;
        y = randBell() * 0.04;
        const normR = (r - innerSanctuaryR) / (maxR - innerSanctuaryR);
        mistColor[i] = pickGalaxyColorByRadius(normR);
        mistSize[i] = 2;
        mistAlpha[i] = (0.018 + Math.random() * 0.020) * smoothstep(0.68, 0.95, r) * (1 - normR * 0.35);
      }

      mistGx[i] = r * Math.cos(theta);
      mistGy[i] = y;
      mistGz[i] = r * Math.sin(theta);
    }
  }

  // --- 26,000-PARTICLE 3D VOLUMETRIC HEART (CLEAN HOLLOW CENTER — ZERO CENTER COLUMN!) ---
  const cloudWx = new Float32Array(HEART_COUNT);
  const cloudWy = new Float32Array(HEART_COUNT);
  const cloudWz = new Float32Array(HEART_COUNT);

  const arcS0 = new Float32Array(HEART_COUNT);     // Normalized arc-length position [0, 1)
  const arcLapRate = new Float32Array(HEART_COUNT); // Laps per second (~1 / 40s)
  const radialScaleR = new Float32Array(HEART_COUNT);
  const jitterRawX = new Float32Array(HEART_COUNT);
  const jitterRawY = new Float32Array(HEART_COUNT);
  const shellSideZ = new Float32Array(HEART_COUNT);

  const targetWx0 = new Float32Array(HEART_COUNT);
  const targetWy0 = new Float32Array(HEART_COUNT);
  const targetWz0 = new Float32Array(HEART_COUNT);

  const ctrl1Wx = new Float32Array(HEART_COUNT);
  const ctrl1Wy = new Float32Array(HEART_COUNT);
  const ctrl1Wz = new Float32Array(HEART_COUNT);
  const ctrl2Wx = new Float32Array(HEART_COUNT);
  const ctrl2Wy = new Float32Array(HEART_COUNT);
  const ctrl2Wz = new Float32Array(HEART_COUNT);

  const appearDelay = new Float32Array(HEART_COUNT);
  const weaveDelay = new Float32Array(HEART_COUNT);
  const weaveDuration = new Float32Array(HEART_COUNT);

  const waveDelayArr = new Float32Array(HEART_COUNT);
  const pushMaxWorld = new Float32Array(HEART_COUNT);
  const springDisp = new Float32Array(HEART_COUNT);
  const springVel = new Float32Array(HEART_COUNT);
  const lastLubWaveCycle = new Int32Array(HEART_COUNT);
  const lastDubWaveCycle = new Int32Array(HEART_COUNT);

  const floatAmp = new Float32Array(HEART_COUNT);
  const floatFreqX = new Float32Array(HEART_COUNT);
  const floatFreqY = new Float32Array(HEART_COUNT);
  const floatPhaseX = new Float32Array(HEART_COUNT);
  const floatPhaseY = new Float32Array(HEART_COUNT);

  const baseAlphaArr = new Float32Array(HEART_COUNT);
  const heartSizeKind = new Uint8Array(HEART_COUNT);
  const colorIdxArr = new Uint8Array(HEART_COUNT);

  function computeHeartShellZ(wx, wy, r, shellParam) {
    const verticalNorm = Math.max(0, Math.min(1, wy + 0.5));
    const lobePlumpness = Math.pow(Math.sin(verticalNorm * Math.PI * 0.88), 0.72);
    const clampedR = Math.min(1.06, r);
    const dome = Math.sqrt(Math.max(0.02, 1.14 - clampedR * clampedR));
    return shellParam * 0.22 * dome * (0.25 + 0.75 * lobePlumpness);
  }

  // Sample strictly via uniform Arc-Length s0 in [0, 1) with NO central spine/seam!
  // Keeps interior r >= 0.58 clear so the 3 "Little Stars" lines sit in a clean, dark velvet heart center!
  function sampleHeart3DDescriptor(index) {
    const u = index / HEART_COUNT;
    const baseLapRate = 1.0 / CONTOUR_LAP_SECONDS;
    const s0 = Math.random();
    const t0 = arcFractionToT(s0);
    const { x, y } = evalParametricHeart(t0);

    if (u < 0.74) {
      // 1) Super-dense, even 3D contour rim (~74% = 19,240 particles)
      const inward = Math.pow(Math.random(), 2.5) * 0.14;
      const r = 1.005 - inward;
      const jx = (Math.random() - 0.5) * 0.34;
      const jy = (Math.random() - 0.5) * 0.34;
      const shellParam = randBell() * 0.72;

      const rawX = x * r + jx;
      const rawY = HEART_FOCUS_Y + (y - HEART_FOCUS_Y) * r + jy;
      const wx = rawX / heartYSpan;
      const wy = (rawY - heartYMid) / heartYSpan;
      const wz = computeHeartShellZ(wx, wy, r, shellParam);

      return {
        s0,
        lapRate: baseLapRate * (0.93 + Math.random() * 0.14),
        r,
        jx,
        jy,
        shellParam,
        wx,
        wy,
        wz,
        alpha: 0.52 + Math.random() * 0.48,
        sizeKind: Math.random() < 0.52 ? 0 : 1,
        pushWorld: 0.020 + Math.random() * 0.012
      };
    }

    if (u < 0.81) {
      // 2) Radiant outer pink spark aura (~7% = 1,820 particles)
      const out = 1.012 + Math.pow(Math.random(), 1.75) * 0.11;
      const jx = (Math.random() - 0.5) * 0.48;
      const jy = (Math.random() - 0.5) * 0.48;
      const shellParam = (Math.random() - 0.5) * 1.1;

      const rawX = x * out + jx;
      const rawY = HEART_FOCUS_Y + (y - HEART_FOCUS_Y) * out + jy;
      const wx = rawX / heartYSpan;
      const wy = (rawY - heartYMid) / heartYSpan;
      const wz = computeHeartShellZ(wx, wy, out, shellParam);

      return {
        s0,
        lapRate: baseLapRate * (0.90 + Math.random() * 0.20),
        r: out,
        jx,
        jy,
        shellParam,
        wx,
        wy,
        wz,
        alpha: 0.42 + Math.random() * 0.34,
        sizeKind: 0,
        pushWorld: 0.024 + Math.random() * 0.010
      };
    }

    // 3) Soft inner 3D shell (~19% = 4,940 particles) tapering from r=0.86 to r=0.58,
    // leaving the central text sanctuary completely open, dark, and column-free!
    const depth = Math.pow(Math.random(), 1.65);
    const r = 0.86 - depth * 0.28;
    const jx = (Math.random() - 0.5) * 0.44;
    const jy = (Math.random() - 0.5) * 0.44;
    const frontOrBack = Math.random() < 0.5 ? 1 : -1;
    const shellParam = frontOrBack * (0.76 + Math.random() * 0.32);

    const rawX = x * r + jx;
    const rawY = HEART_FOCUS_Y + (y - HEART_FOCUS_Y) * r + jy;
    const wx = rawX / heartYSpan;
    const wy = (rawY - heartYMid) / heartYSpan;
    const wz = computeHeartShellZ(wx, wy, r, shellParam);

    return {
      s0,
      lapRate: baseLapRate * (0.45 + 0.45 * r),
      r,
      jx,
      jy,
      shellParam,
      wx,
      wy,
      wz,
      alpha: 0.34 + Math.random() * (0.06 + (r - 0.55) * 0.9),
      sizeKind: Math.random() < 0.78 ? 0 : 1,
      pushWorld: 0.014 + r * 0.014
    };
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  function initHeartParticles() {
    const leftPool = [];
    const rightPool = [];

    for (let i = 0; i < HEART_COUNT; i++) {
      const desc = sampleHeart3DDescriptor(i);
      if (desc.wx < 0) leftPool.push(desc);
      else rightPool.push(desc);
    }

    shuffleArray(leftPool);
    shuffleArray(rightPool);

    let leftPtr = 0;
    let rightPtr = 0;
    const ribbonCount = 18;
    const cloudSphereRadius = 0.125;

    lastLubWaveCycle.fill(-1);
    lastDubWaveCycle.fill(-1);

    for (let i = 0; i < HEART_COUNT; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * TAU;
      const root = Math.sqrt(1 - u * u);
      const rad = Math.cbrt(Math.random()) * cloudSphereRadius;

      const cWx = rad * root * Math.cos(phi);
      const cWy = rad * u;
      const cWz = rad * root * Math.sin(phi);
      cloudWx[i] = cWx;
      cloudWy[i] = cWy;
      cloudWz[i] = cWz;

      const side = cWx < 0 ? -1 : 1;
      const wantOpposite = Math.random() < 0.72;
      let chosen;
      if ((side < 0 && wantOpposite) || (side > 0 && !wantOpposite)) {
        chosen = rightPtr < rightPool.length ? rightPool[rightPtr++] : leftPool[leftPtr++];
      } else {
        chosen = leftPtr < leftPool.length ? leftPool[leftPtr++] : rightPool[rightPtr++];
      }

      arcS0[i] = chosen.s0;
      arcLapRate[i] = chosen.lapRate;
      radialScaleR[i] = chosen.r;
      jitterRawX[i] = chosen.jx;
      jitterRawY[i] = chosen.jy;
      shellSideZ[i] = chosen.shellParam;

      targetWx0[i] = chosen.wx;
      targetWy0[i] = chosen.wy;
      targetWz0[i] = chosen.wz;

      baseAlphaArr[i] = chosen.alpha;
      heartSizeKind[i] = chosen.sizeKind;
      colorIdxArr[i] = pickWeightedHeartColor();
      pushMaxWorld[i] = chosen.pushWorld;

      const dist3D = Math.hypot(chosen.wx, chosen.wy, chosen.wz);
      const normDist = Math.min(1.12, dist3D / maxHeartNormDist);
      waveDelayArr[i] = normDist * 0.145;

      const ribbonIdx = i % ribbonCount;
      const ribbonBaseDelay = (ribbonIdx / ribbonCount) * 0.78;
      const delay = Math.min(1.05, Math.max(0, ribbonBaseDelay + Math.random() * 0.30));
      const maxDur = 3.5 - delay;
      const dur = Math.min(maxDur, 2.15 + Math.random() * 0.30);

      weaveDelay[i] = delay;
      weaveDuration[i] = dur;
      appearDelay[i] = Math.random() * 0.28;

      const ribbonBand = ribbonIdx / (ribbonCount - 1) - 0.5;
      ctrl1Wx[i] = -side * (0.24 + Math.random() * 0.34 + Math.abs(ribbonBand) * 0.14);
      ctrl1Wy[i] = 0.10 + Math.random() * 0.28 + (ribbonBand + 0.5) * 0.12;
      ctrl1Wz[i] = Math.sin(ribbonIdx * 0.9) * 0.18 + (Math.random() - 0.5) * 0.12;

      ctrl2Wx[i] = chosen.wx * (0.82 + Math.random() * 0.34) - side * 0.06;
      ctrl2Wy[i] = Math.max(chosen.wy, 0.14) + (0.14 + Math.random() * 0.26);
      ctrl2Wz[i] = chosen.wz * 1.15 + (Math.random() - 0.5) * 0.10;

      floatAmp[i] = 0.0030 + Math.random() * 0.0030;
      floatFreqX[i] = 1.15 + Math.random() * 1.45;
      floatFreqY[i] = 1.15 + Math.random() * 1.45;
      floatPhaseX[i] = Math.random() * TAU;
      floatPhaseY[i] = Math.random() * TAU;
    }
  }

  // --- 3D EQUATORIAL BEAT RIPPLES ---
  const ripples = [];
  let lastRippleCycle = -1;

  function spawnRipple() {
    if (ripples.length >= MAX_RIPPLES) {
      ripples.shift();
    }
    ripples.push({ age: 0 });
  }

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) * 0.5;
  }

  function cosineInterp(a, b, t) {
    const f = (1 - Math.cos(Math.PI * t)) * 0.5;
    return a + (b - a) * f;
  }

  function getHeartbeatScale(beatElapsed) {
    const phase = (((beatElapsed % BEAT_PERIOD) + BEAT_PERIOD) % BEAT_PERIOD) / BEAT_PERIOD;
    if (phase < 0.13) return cosineInterp(1.00, 1.10, phase / 0.13);
    if (phase < 0.26) return cosineInterp(1.10, 1.03, (phase - 0.13) / 0.13);
    if (phase < 0.39) return cosineInterp(1.03, 1.07, (phase - 0.26) / 0.13);
    if (phase < 0.60) return cosineInterp(1.07, 1.00, (phase - 0.39) / 0.21);
    return 1.00;
  }

  // --- INTERACTIVE 360° ORBIT & PINCH/WHEEL ZOOM ---
  function setupInteraction() {
    window.addEventListener("pointerdown", (e) => {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        isDragging = true;
        lastDragX = e.clientX;
        lastDragY = e.clientY;
        velYaw = 0;
        velPitch = 0;
        document.body.classList.add("is-dragging");
      } else if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    });

    window.addEventListener("pointermove", (e) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (lastPinchDist > 8) {
          const ratio = dist / lastPinchDist;
          targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom * ratio));
        }
        lastPinchDist = dist;
        return;
      }

      if (isDragging && activePointers.size === 1) {
        const dx = e.clientX - lastDragX;
        const dy = e.clientY - lastDragY;
        lastDragX = e.clientX;
        lastDragY = e.clientY;

        const sensitivity = 3.2 / Math.max(320, minDim);
        const uprightSign = Math.cos(camPitch) >= 0 ? 1 : -1;
        const dYaw = -dx * sensitivity * uprightSign;
        const dPitch = dy * sensitivity;

        camYaw = (camYaw + dYaw) % TAU;
        camPitch = (camPitch + dPitch) % TAU;

        velYaw = dYaw * 55;
        velPitch = dPitch * 55;
      }
    }, { passive: true });

    function endPointer(e) {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) {
        lastPinchDist = 0;
      }
      if (activePointers.size === 1) {
        const remaining = activePointers.values().next().value;
        lastDragX = remaining.x;
        lastDragY = remaining.y;
      } else if (activePointers.size === 0) {
        isDragging = false;
        document.body.classList.remove("is-dragging");
      }
    }

    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);

    window.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0011);
      targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom * factor));
    }, { passive: false });
  }

  // Reduced-motion handling
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let prefersReducedMotion = reducedMotionQuery.matches;
  let elapsed = prefersReducedMotion ? PHASE_WEAVE_END : 0;
  let galaxySpinAngle = 0;
  let lastTimestamp = 0;

  function onReducedMotionChange(e) {
    prefersReducedMotion = e.matches;
    if (prefersReducedMotion) {
      if (elapsed < PHASE_WEAVE_END) elapsed = PHASE_WEAVE_END;
      ripples.length = 0;
      springDisp.fill(0);
      springVel.fill(0);
      rootStyle.setProperty("--beat", "0");
    } else {
      const currentCycle = Math.floor(Math.max(0, elapsed - PHASE_WEAVE_END) / BEAT_PERIOD);
      lastRippleCycle = currentCycle;
      lastLubWaveCycle.fill(currentCycle);
      lastDubWaveCycle.fill(currentCycle);
    }
  }

  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", onReducedMotionChange);
  } else if (typeof reducedMotionQuery.addListener === "function") {
    reducedMotionQuery.addListener(onReducedMotionChange);
  }

  function handleResize() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    const physW = Math.max(1, Math.round(vw * dpr));
    const physH = Math.max(1, Math.round(vh * dpr));

    bgCanvas.width = physW;
    bgCanvas.height = physH;
    heartCanvas.width = physW;
    heartCanvas.height = physH;

    rasterScale = Math.min(dpr, vw < 600 ? 1.4 : 1.15);
    const newRW = Math.max(2, Math.round(vw * rasterScale));
    const newRH = Math.max(2, Math.round(vh * rasterScale));

    if (newRW !== rasterW || newRH !== rasterH || !imgData) {
      rasterW = newRW;
      rasterH = newRH;
      rasterCanvas.width = rasterW;
      rasterCanvas.height = rasterH;
      imgData = rasterCtx.createImageData(rasterW, rasterH);
      pix8 = imgData.data;
      pix32 = new Uint32Array(pix8.buffer);
      pix32.fill(0xff000000);
    }

    if (dpr !== lastMistDpr) {
      buildMistSprites(dpr);
      lastMistDpr = dpr;
    }

    minDim = Math.min(vw, vh);
    heartBaseScale = minDim * 0.52;
  }

  // --- FAST PIXEL BUFFER KERNELS ---
  function splat1x1(x, y, r, g, b) {
    const idx = (y * rasterW + x) << 2;
    pix8[idx] += r;
    pix8[idx + 1] += g;
    pix8[idx + 2] += b;
  }

  function splat2x2Soft(x, y, r, g, b) {
    const stride = rasterW << 2;
    const idx = (y * rasterW + x) << 2;
    pix8[idx] += r;
    pix8[idx + 1] += g;
    pix8[idx + 2] += b;

    const r2 = (r * 0.58) | 0;
    const g2 = (g * 0.58) | 0;
    const b2 = (b * 0.58) | 0;

    pix8[idx + 4] += r2;
    pix8[idx + 5] += g2;
    pix8[idx + 6] += b2;

    const row2 = idx + stride;
    pix8[row2] += r2;
    pix8[row2 + 1] += g2;
    pix8[row2 + 2] += b2;

    const r3 = (r * 0.34) | 0;
    const g3 = (g * 0.34) | 0;
    const b3 = (b * 0.34) | 0;
    pix8[row2 + 4] += r3;
    pix8[row2 + 5] += g3;
    pix8[row2 + 6] += b3;
  }

  function splatStarCross(x, y, r, g, b) {
    const stride = rasterW << 2;
    const idx = (y * rasterW + x) << 2;

    pix8[idx] += Math.min(255, r + 90);
    pix8[idx + 1] += Math.min(255, g + 90);
    pix8[idx + 2] += Math.min(255, b + 90);

    const cr = (r * 0.72) | 0;
    const cg = (g * 0.72) | 0;
    const cb = (b * 0.72) | 0;

    const left = idx - 4;
    const right = idx + 4;
    const up = idx - stride;
    const down = idx + stride;

    pix8[left] += cr; pix8[left + 1] += cg; pix8[left + 2] += cb;
    pix8[right] += cr; pix8[right + 1] += cg; pix8[right + 2] += cb;
    pix8[up] += cr; pix8[up + 1] += cg; pix8[up + 2] += cb;
    pix8[down] += cr; pix8[down + 1] += cg; pix8[down + 2] += cb;

    const dr = (r * 0.28) | 0;
    const dg = (g * 0.28) | 0;
    const db = (b * 0.28) | 0;
    const ul = up - 4;
    const ur = up + 4;
    const dl = down - 4;
    const dd = down + 4;

    pix8[ul] += dr; pix8[ul + 1] += dg; pix8[ul + 2] += db;
    pix8[ur] += dr; pix8[ur + 1] += dg; pix8[ur + 2] += db;
    pix8[dl] += dr; pix8[dl + 1] += dg; pix8[dl + 2] += db;
    pix8[dd] += dr; pix8[dd + 1] += dg; pix8[dd + 2] += db;
  }

  function splatHeartSwollen(x, y, r, g, b) {
    const stride = rasterW << 2;
    const idx = (y * rasterW + x) << 2;

    pix8[idx] += r;
    pix8[idx + 1] += g;
    pix8[idx + 2] += b;

    const cr = (r * 0.76) | 0;
    const cg = (g * 0.76) | 0;
    const cb = (b * 0.76) | 0;

    const left = idx - 4;
    const right = idx + 4;
    const up = idx - stride;
    const down = idx + stride;

    pix8[left] += cr; pix8[left + 1] += cg; pix8[left + 2] += cb;
    pix8[right] += cr; pix8[right + 1] += cg; pix8[right + 2] += cb;
    pix8[up] += cr; pix8[up + 1] += cg; pix8[up + 2] += cb;
    pix8[down] += cr; pix8[down + 1] += cg; pix8[down + 2] += cb;

    const dr = (r * 0.42) | 0;
    const dg = (g * 0.42) | 0;
    const db = (b * 0.42) | 0;
    const ul = up - 4;
    const ur = up + 4;
    const dl = down - 4;
    const dd = down + 4;

    pix8[ul] += dr; pix8[ul + 1] += dg; pix8[ul + 2] += db;
    pix8[ur] += dr; pix8[ur + 1] += dg; pix8[ur + 2] += db;
    pix8[dl] += dr; pix8[dl + 1] += dg; pix8[dl + 2] += db;
    pix8[dd] += dr; pix8[dd + 1] += dg; pix8[dd + 2] += db;
  }

  function renderBackgroundCanvas(
    cosCamYaw,
    sinCamYaw,
    cosGalYaw,
    sinGalYaw,
    cosPitch,
    sinPitch,
    camDist,
    fovPhys,
    centerPhysX,
    centerPhysY,
    galaxyFade
  ) {
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

    if (galaxyFade > 0.01) {
      bgCtx.globalCompositeOperation = "lighter";
      const wLimit = bgCanvas.width;
      const hLimit = bgCanvas.height;
      const maxMistA = MIST_ALPHA_STEPS - 1;

      for (let i = 0; i < GALAXY_MIST_COUNT; i++) {
        const gx = mistGx[i];
        const gy = mistGy[i];
        const gz = mistGz[i];

        const x1 = gx * cosGalYaw + gz * sinGalYaw;
        const z1 = -gx * sinGalYaw + gz * cosGalYaw;
        const vy = gy * cosPitch - z1 * sinPitch;
        const vz = gy * sinPitch + z1 * cosPitch;

        const depth = camDist - vz;
        if (depth <= 0.45) continue;

        const proj = fovPhys / depth;
        const sx = centerPhysX + x1 * proj;
        const sy = centerPhysY - vy * proj;
        if (sx < -60 || sx > wLimit + 60 || sy < -60 || sy > hLimit + 60) continue;

        const alpha = mistAlpha[i] * galaxyFade;
        let aIdx = Math.round(((alpha - 0.018) / 0.055) * maxMistA);
        if (aIdx < 0) aIdx = 0;
        else if (aIdx > maxMistA) aIdx = maxMistA;

        const sIdx = mistSize[i];
        const sprite = mistSprites[mistColor[i]][sIdx][aIdx];
        const half = mistSpriteHalf[sIdx];
        bgCtx.drawImage(sprite, sx - half, sy - half);
      }
    }

    if (!prefersReducedMotion && ripples.length > 0) {
      bgCtx.globalCompositeOperation = "lighter";
      bgCtx.strokeStyle = "#FF2D78";
      bgCtx.lineWidth = 1.3 * dpr;

      for (let rIdx = 0; rIdx < ripples.length; rIdx++) {
        const ring = ripples[rIdx];
        const progress = ring.age / RIPPLE_DURATION;
        if (progress >= 1) continue;

        const easeOut = 1 - Math.pow(1 - progress, 1.6);
        const radius = 0.44 + easeOut * 1.05;
        bgCtx.globalAlpha = 0.38 * (1 - progress);
        bgCtx.beginPath();

        let penDown = false;
        for (let k = 0; k <= RIPPLE_SEGMENTS; k++) {
          const angle = (k / RIPPLE_SEGMENTS) * TAU;
          const wx = radius * Math.cos(angle);
          const wz = radius * Math.sin(angle);

          const x1 = wx * cosCamYaw + wz * sinCamYaw;
          const z1 = -wx * sinCamYaw + wz * cosCamYaw;
          const vy = -z1 * sinPitch;
          const vz = z1 * cosPitch;
          const depth = camDist - vz;

          if (depth <= 0.45) {
            penDown = false;
            continue;
          }

          const proj = fovPhys / depth;
          const sx = centerPhysX + x1 * proj;
          const sy = centerPhysY - vy * proj;

          if (!penDown) {
            bgCtx.moveTo(sx, sy);
            penDown = true;
          } else {
            bgCtx.lineTo(sx, sy);
          }
        }
        bgCtx.stroke();
      }
      bgCtx.globalAlpha = 1;
    }
  }

  function rasterizeSkyStars(cosCamYaw, sinCamYaw, cosPitch, sinPitch, camDist, fovRaster, cxR, cyR) {
    const maxX = rasterW - 3;
    const maxY = rasterH - 3;

    for (let i = 0; i < SKY_STAR_COUNT; i++) {
      const wx = skyWx[i];
      const wy = skyWy[i];
      const wz = skyWz[i];

      const x1 = wx * cosCamYaw + wz * sinCamYaw;
      const z1 = -wx * sinCamYaw + wz * cosCamYaw;
      const vy = wy * cosPitch - z1 * sinPitch;
      const vz = wy * sinPitch + z1 * cosPitch;

      const depth = camDist + 4.5 - vz * 0.45;
      if (depth <= 0.3) continue;

      const proj = fovRaster / depth;
      const sx = (cxR + x1 * proj) | 0;
      if (sx < 2 || sx > maxX) continue;
      const sy = (cyR - vy * proj) | 0;
      if (sy < 2 || sy > maxY) continue;

      const lum = skyBright[i] * twinkleLUT[i & TWINKLE_MASK];
      const cIdx = skyColor[i];
      const r = (galColorR[cIdx] * lum) | 0;
      const g = (galColorG[cIdx] * lum) | 0;
      const b = (galColorB[cIdx] * lum) | 0;

      const kind = skyKind[i];
      if (kind === 0) splat1x1(sx, sy, r, g, b);
      else if (kind === 1) splat2x2Soft(sx, sy, r, g, b);
      else splatStarCross(sx, sy, r, g, b);
    }
  }

  function rasterizeGalaxyHalf(
    frontPass,
    cosGalYaw,
    sinGalYaw,
    cosPitch,
    sinPitch,
    camDist,
    fovRaster,
    cxR,
    cyR,
    beatNormalized,
    galaxyFade
  ) {
    if (galaxyFade <= 0.01) return;

    const maxX = rasterW - 3;
    const maxY = rasterH - 3;
    const innerBeat = beatNormalized * 0.16;

    const heartScreenRad = (fovRaster / camDist) * 0.58;
    const invHeartRadSq = 1 / Math.max(16, heartScreenRad * heartScreenRad);

    for (let i = 0; i < GALAXY_STAR_COUNT; i++) {
      const gx = galGx[i];
      const gy = galGy[i];
      const gz = galGz[i];

      const x1 = gx * cosGalYaw + gz * sinGalYaw;
      const z1 = -gx * sinGalYaw + gz * cosGalYaw;
      const vy = gy * cosPitch - z1 * sinPitch;
      const vz = gy * sinPitch + z1 * cosPitch;

      if (frontPass ? vz <= 0 : vz > 0) continue;

      const depth = camDist - vz;
      if (depth <= 0.42) continue;

      const proj = fovRaster / depth;
      const sx = (cxR + x1 * proj) | 0;
      if (sx < 2 || sx > maxX) continue;
      const sy = (cyR - vy * proj) | 0;
      if (sy < 2 || sy > maxY) continue;

      const nearFade = depth < 1.0 ? (depth - 0.42) * 1.72 : 1.0;
      let lum =
        (galBright[i] * twinkleLUT[i & TWINKLE_MASK] + galInnerWeight[i] * innerBeat) *
        galaxyFade *
        nearFade;

      const dx = sx - cxR;
      const dy = sy - cyR;
      const normDistSq = (dx * dx + dy * dy) * invHeartRadSq;
      if (normDistSq < 1.0) {
        const shield = frontPass
          ? 0.16 + 0.84 * normDistSq * normDistSq
          : 0.28 + 0.72 * normDistSq;
        lum *= shield;
      }

      if (lum > 1.0) lum = 1.0;

      const cIdx = galColor[i];
      const r = (galColorR[cIdx] * lum) | 0;
      const g = (galColorG[cIdx] * lum) | 0;
      const b = (galColorB[cIdx] * lum) | 0;

      const kind = galKind[i];
      if (kind === 0) {
        if (depth < 2.65) splat2x2Soft(sx, sy, (r * 0.72) | 0, (g * 0.72) | 0, (b * 0.72) | 0);
        else splat1x1(sx, sy, r, g, b);
      } else if (kind === 1) {
        splat2x2Soft(sx, sy, r, g, b);
      } else {
        splatStarCross(sx, sy, r, g, b);
      }
    }
  }

  function rasterizeHeart3D(
    dt,
    cosCamYaw,
    sinCamYaw,
    cosPitch,
    sinPitch,
    camDist,
    fovRaster,
    cxR,
    cyR,
    heartScale,
    beatNormalized
  ) {
    const maxX = rasterW - 3;
    const maxY = rasterH - 3;
    const floatFactor = prefersReducedMotion ? 0.35 : 1.0;

    const inPhase3 = !prefersReducedMotion && elapsed >= PHASE_WEAVE_END;
    const beatElapsed = inPhase3 ? elapsed - PHASE_WEAVE_END : 0;
    const currentCycle = inPhase3 ? Math.floor(beatElapsed / BEAT_PERIOD) : -1;
    const dubOffset = 0.26 * BEAT_PERIOD;
    const invHeartYSpan = 1 / heartYSpan;

    for (let i = 0; i < HEART_COUNT; i++) {
      let wx = 0;
      let wy = 0;
      let wz = 0;
      let alpha = baseAlphaArr[i];
      let waveSwell = 0;

      const fPhaseX = elapsed * floatFreqX[i] + floatPhaseX[i];
      const fPhaseY = elapsed * floatFreqY[i] + floatPhaseY[i];
      const fAmp = floatAmp[i];

      if (!prefersReducedMotion && elapsed < PHASE_CLOUD_END) {
        const fadeIn = Math.min(1, Math.max(0, (elapsed - appearDelay[i]) / 0.32));
        if (fadeIn <= 0.01) continue;

        wx = cloudWx[i] + Math.sin(fPhaseX * 1.35) * (fAmp * 2.0);
        wy = cloudWy[i] + Math.cos(fPhaseY * 1.35) * (fAmp * 2.0);
        wz = cloudWz[i] + Math.sin((fPhaseX + fPhaseY) * 0.9) * (fAmp * 2.0);

        alpha = alpha * (0.72 + 0.28 * Math.sin(fPhaseX * 2.2 + floatPhaseY[i])) * fadeIn;
      } else if (!prefersReducedMotion && elapsed < PHASE_WEAVE_END) {
        const weaveTime = elapsed - PHASE_CLOUD_END - weaveDelay[i];
        const driftScale = weaveTime <= 0 ? 1 : Math.max(0, 1 - weaveTime / 0.6);

        const sWx = cloudWx[i] + Math.sin(fPhaseX * 1.35) * (fAmp * 2.0) * driftScale;
        const sWy = cloudWy[i] + Math.cos(fPhaseY * 1.35) * (fAmp * 2.0) * driftScale;
        const sWz = cloudWz[i] + Math.sin((fPhaseX + fPhaseY) * 0.9) * (fAmp * 2.0) * driftScale;

        if (weaveTime <= 0) {
          wx = sWx;
          wy = sWy;
          wz = sWz;
          alpha *= 0.72 + 0.28 * Math.sin(fPhaseX * 2.2 + floatPhaseY[i]);
        } else {
          const rawU = Math.min(1, weaveTime / weaveDuration[i]);
          const u = easeInOutCubic(rawU);
          const inv = 1 - u;

          const endFx = Math.sin(fPhaseX) * fAmp * (rawU * rawU);
          const endFy = Math.cos(fPhaseY) * fAmp * (rawU * rawU);
          const endFz = Math.sin(fPhaseX - fPhaseY) * fAmp * (rawU * rawU);

          const p3x = targetWx0[i] + endFx;
          const p3y = targetWy0[i] + endFy;
          const p3z = targetWz0[i] + endFz;

          const inv2 = inv * inv;
          const inv3 = inv2 * inv;
          const u2 = u * u;
          const u3 = u2 * u;

          wx = inv3 * sWx + 3 * inv2 * u * ctrl1Wx[i] + 3 * inv * u2 * ctrl2Wx[i] + u3 * p3x;
          wy = inv3 * sWy + 3 * inv2 * u * ctrl1Wy[i] + 3 * inv * u2 * ctrl2Wy[i] + u3 * p3y;
          wz = inv3 * sWz + 3 * inv2 * u * ctrl1Wz[i] + 3 * inv * u2 * ctrl2Wz[i] + u3 * p3z;

          alpha = Math.min(1.0, alpha + Math.sin(rawU * Math.PI) * 0.14);
        }
      } else {
        let baseWx = targetWx0[i];
        let baseWy = targetWy0[i];
        let baseWz = targetWz0[i];

        // Slide smoothly at constant linear speed via Arc-Length lookup (zero bunching!)
        if (!prefersReducedMotion) {
          const curArcS = arcS0[i] + arcLapRate[i] * beatElapsed;
          const t = arcFractionToT(curArcS);
          const s = Math.sin(t);
          const c = Math.cos(t);
          const bx = 16 * s * s * s;
          const c2 = 2 * c * c - 1;
          const c3 = 4 * c * c * c - 3 * c;
          const c4 = 2 * c2 * c2 - 1;
          const by = 13 * c - 5 * c2 - 2 * c3 - c4;

          const r = radialScaleR[i];
          const rawX = bx * r + jitterRawX[i];
          const rawY = HEART_FOCUS_Y + (by - HEART_FOCUS_Y) * r + jitterRawY[i];
          baseWx = rawX * invHeartYSpan;
          baseWy = (rawY - heartYMid) * invHeartYSpan;
          baseWz = computeHeartShellZ(baseWx, baseWy, r, shellSideZ[i]);
        }

        let pushWorld = 0;
        if (inPhase3) {
          const pDelay = waveDelayArr[i];
          if (currentCycle > lastLubWaveCycle[i]) {
            if (beatElapsed >= currentCycle * BEAT_PERIOD + pDelay) {
              lastLubWaveCycle[i] = currentCycle;
              springVel[i] += pushMaxWorld[i] * SPRING_PEAK_VEL_GAIN;
            }
          }
          if (currentCycle > lastDubWaveCycle[i]) {
            if (beatElapsed >= currentCycle * BEAT_PERIOD + dubOffset + pDelay) {
              lastDubWaveCycle[i] = currentCycle;
              springVel[i] += pushMaxWorld[i] * 0.60 * SPRING_PEAK_VEL_GAIN;
            }
          }

          let disp = springDisp[i];
          let vel = springVel[i];
          vel += (-SPRING_K * disp - SPRING_DAMP * vel) * dt;
          disp += vel * dt;
          springDisp[i] = disp;
          springVel[i] = vel;

          pushWorld = disp;
          if (disp > 0) {
            waveSwell = Math.min(1, disp / pushMaxWorld[i]);
          }
        }

        const len3 = Math.hypot(baseWx, baseWy, baseWz);
        const dirX = len3 > 1e-4 ? baseWx / len3 : 0;
        const dirY = len3 > 1e-4 ? baseWy / len3 : 1;
        const dirZ = len3 > 1e-4 ? baseWz / len3 : 0;

        const fx = Math.sin(fPhaseX) * fAmp * floatFactor;
        const fy = Math.cos(fPhaseY) * fAmp * floatFactor;
        const fz = Math.sin(fPhaseX - fPhaseY) * fAmp * floatFactor;

        wx = baseWx * heartScale + dirX * pushWorld + fx;
        wy = baseWy * heartScale + dirY * pushWorld + fy;
        wz = baseWz * heartScale + dirZ * pushWorld + fz;

        alpha = Math.min(1.0, alpha + waveSwell * 0.36 + beatNormalized * 0.16);
      }

      const x1 = wx * cosCamYaw + wz * sinCamYaw;
      const z1 = -wx * sinCamYaw + wz * cosCamYaw;
      const vy = wy * cosPitch - z1 * sinPitch;
      const vz = wy * sinPitch + z1 * cosPitch;

      const depth = camDist - vz;
      if (depth <= 0.35) continue;

      const proj = fovRaster / depth;
      const sx = (cxR + x1 * proj) | 0;
      if (sx < 2 || sx > maxX) continue;
      const sy = (cyR - vy * proj) | 0;
      if (sy < 2 || sy > maxY) continue;

      const lum = alpha * 0.44;
      const cIdx = colorIdxArr[i];
      const r = (heartColorR[cIdx] * lum) | 0;
      const g = (heartColorG[cIdx] * lum) | 0;
      const b = (heartColorB[cIdx] * lum) | 0;

      if (waveSwell > 0.35) {
        splatHeartSwollen(sx, sy, r, g, b);
      } else if (heartSizeKind[i] === 1 || depth < 2.25) {
        splat2x2Soft(sx, sy, r, g, b);
      } else {
        splat1x1(
          sx,
          sy,
          Math.min(255, (r * 1.35) | 0),
          Math.min(255, (g * 1.35) | 0),
          Math.min(255, (b * 1.35) | 0)
        );
      }
    }
  }

  function updateOverlays(heartScale) {
    if (!heartTextShown && heartTextEl && elapsed >= PHASE_WEAVE_END) {
      heartTextShown = true;
      heartTextEl.classList.add("is-visible");
    }
    if (!captionShown && hasCaption && captionEl && elapsed >= PHASE_WEAVE_END) {
      captionShown = true;
      captionEl.classList.add("is-visible");
    }

    // Keep center Little Stars text scaled smoothly with Zoom & gentle 72 BPM heartbeat pulse
    const pulseScale = 1 + (heartScale - 1.0) * 0.65;
    rootStyle.setProperty("--heart-ui-scale", (zoom * pulseScale).toFixed(4));
  }

  function tick(timestamp) {
    if (lastTimestamp === 0) {
      lastTimestamp = timestamp;
    }
    const rawDt = (timestamp - lastTimestamp) * 0.001;
    lastTimestamp = timestamp;
    const dt = Math.min(Math.max(rawDt, 0), 0.05);
    elapsed += dt;

    updateTwinkleTable();

    if (!isDragging) {
      camYaw = (camYaw + velYaw * dt) % TAU;
      camPitch = (camPitch + velPitch * dt) % TAU;
      const damping = Math.exp(-4.6 * dt);
      velYaw *= damping;
      velPitch *= damping;
      if (Math.abs(velYaw) < 1e-4) velYaw = 0;
      if (Math.abs(velPitch) < 1e-4) velPitch = 0;
    }
    zoom += (targetZoom - zoom) * Math.min(1, dt * 10);

    if (!prefersReducedMotion) {
      galaxySpinAngle = (galaxySpinAngle + GALAXY_SPIN_SPEED * dt) % TAU;
    }

    let heartScale = 1.0;
    let beatNormalized = 0.0;

    if (prefersReducedMotion) {
      const breath = 0.5 - 0.5 * Math.cos(elapsed * (TAU / 3.8));
      heartScale = 1.0 + breath * 0.03;
      beatNormalized = breath * 0.12;
      rootStyle.setProperty("--beat", "0");
    } else if (elapsed >= PHASE_WEAVE_END) {
      const beatElapsed = elapsed - PHASE_WEAVE_END;
      heartScale = getHeartbeatScale(beatElapsed);
      beatNormalized = Math.min(1, Math.max(0, (heartScale - 1.0) / 0.10));
      rootStyle.setProperty("--beat", beatNormalized.toFixed(4));

      const currentCycle = Math.floor(beatElapsed / BEAT_PERIOD);
      if (currentCycle > lastRippleCycle) {
        lastRippleCycle = currentCycle;
        spawnRipple();
      }
      for (let r = ripples.length - 1; r >= 0; r--) {
        ripples[r].age += dt;
        if (ripples[r].age >= RIPPLE_DURATION) {
          ripples.splice(r, 1);
        }
      }
    } else {
      rootStyle.setProperty("--beat", "0");
    }

    updateOverlays(heartScale);

    const cosCamYaw = Math.cos(camYaw);
    const sinCamYaw = Math.sin(camYaw);
    const totalGalYaw = camYaw + galaxySpinAngle;
    const cosGalYaw = Math.cos(totalGalYaw);
    const sinGalYaw = Math.sin(totalGalYaw);
    const cosPitch = Math.cos(camPitch);
    const sinPitch = Math.sin(camPitch);

    const camDist = CAM_BASE_DIST / zoom;
    const galaxyFade = prefersReducedMotion ? 1.0 : Math.min(1.0, 0.30 + (elapsed / PHASE_CLOUD_END) * 0.70);

    const fovPhys = heartBaseScale * CAM_BASE_DIST * dpr;
    renderBackgroundCanvas(
      cosCamYaw,
      sinCamYaw,
      cosGalYaw,
      sinGalYaw,
      cosPitch,
      sinPitch,
      camDist,
      fovPhys,
      vw * 0.5 * dpr,
      vh * 0.5 * dpr,
      galaxyFade
    );

    pix32.fill(0xff000000);

    const fovRaster = heartBaseScale * CAM_BASE_DIST * rasterScale;
    const cxR = rasterW * 0.5;
    const cyR = rasterH * 0.5;

    rasterizeSkyStars(cosCamYaw, sinCamYaw, cosPitch, sinPitch, camDist, fovRaster, cxR, cyR);
    rasterizeGalaxyHalf(
      false,
      cosGalYaw,
      sinGalYaw,
      cosPitch,
      sinPitch,
      camDist,
      fovRaster,
      cxR,
      cyR,
      beatNormalized,
      galaxyFade
    );

    rasterizeHeart3D(
      dt,
      cosCamYaw,
      sinCamYaw,
      cosPitch,
      sinPitch,
      camDist,
      fovRaster,
      cxR,
      cyR,
      heartScale,
      beatNormalized
    );

    rasterizeGalaxyHalf(
      true,
      cosGalYaw,
      sinGalYaw,
      cosPitch,
      sinPitch,
      camDist,
      fovRaster,
      cxR,
      cyR,
      beatNormalized,
      galaxyFade
    );

    rasterCtx.putImageData(imgData, 0, 0);
    heartCtx.setTransform(1, 0, 0, 1, 0, 0);
    heartCtx.imageSmoothingEnabled = true;
    heartCtx.drawImage(rasterCanvas, 0, 0, heartCanvas.width, heartCanvas.height);

    requestAnimationFrame(tick);
  }

  // Boot sequence
  initTwinkleTable();
  computeHeartBoundsAndArcTable();
  initSkyStars();
  initGalaxy();
  initHeartParticles();
  setupInteraction();
  handleResize();
  window.addEventListener("resize", handleResize, { passive: true });
  requestAnimationFrame(tick);
})();
