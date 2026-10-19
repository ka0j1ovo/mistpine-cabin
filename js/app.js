/* =============================================================
   雾杉小屋 · Mistpine Cabin
   A hand-built low-poly 3D scene with Three.js (UMD build).
   Everything — textures, ambience, particles — is generated
   locally. No network connection is required at runtime.
   ============================================================= */

(function () {
  "use strict";

  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

  const canvas = $("#scene");
  const loading = $("#loading");
  const errorCard = $("#errorCard");
  const pointerTip = $("#pointerTip");
  const toastEl = $("#toast");
  const whisperEl = $("#whisper");
  const statusText = $("#statusText");
  const weatherStatus = $("#weatherStatus");
  const resetBtn = $("#resetView");
  const fullscreenBtn = $("#fullscreen");

  const isCompact = window.matchMedia("(max-width: 760px)").matches;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const smoothstep = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const damp = (current, target, lambda, dt) => THREE.MathUtils.damp(current, target, lambda, dt);
  const rand = (min, max) => min + Math.random() * (max - min);

  let seed = 0x51f15e;
  function random() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const rng = (min, max) => min + random() * (max - min);

  if (!window.THREE) {
    showFatal();
    return;
  }

  const state = {
    lightsOn: true,
    fireOn: false,
    weather: "clear",
    doorOpen: false,
    soundOn: false,
    focus: false,
    warmth: 0,
    firePower: 0,
    rainOpacity: 0,
    snowOpacity: 0,
    hovered: null,
    lastInteraction: 0,
    doorSeen: false,
    ready: false
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isCompact,
      alpha: false,
      powerPreference: "high-performance"
    });
  } catch (error) {
    showFatal();
    return;
  }

  renderer.setClearColor(0x08110e, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isCompact ? 1.55 : 1.9));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.23;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08130f);
  scene.fog = new THREE.FogExp2(0x12231f, 0.0175);

  const camera = new THREE.PerspectiveCamera(
    isCompact ? 58 : 39,
    window.innerWidth / window.innerHeight,
    0.1,
    180
  );

  const orbit = {
    azimuth: -0.38,
    targetAzimuth: isCompact ? 0.38 : 0.29,
    polar: 1.24,
    targetPolar: 1.35,
    radius: prefersReducedMotion ? 14.8 : 24,
    targetRadius: isCompact ? 17.8 : 14.8,
    lookY: 2.25,
    targetLookY: 2.25
  };

  const cameraTarget = new THREE.Vector3(0, orbit.lookY, 0);

  /* -----------------------------------------------------------
     Lighting
     ----------------------------------------------------------- */

  const hemi = new THREE.HemisphereLight(0x9cbcc5, 0x1c2a1e, 1.46);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x677d6d, 0.42);
  scene.add(ambient);

  const moonlight = new THREE.DirectionalLight(0xb2d0e2, 2.5);
  moonlight.position.set(13, 19, -8);
  moonlight.target.position.set(0, 1.4, 0);
  moonlight.castShadow = true;
  moonlight.shadow.mapSize.set(isCompact ? 1024 : 2048, isCompact ? 1024 : 2048);
  moonlight.shadow.camera.left = -16;
  moonlight.shadow.camera.right = 16;
  moonlight.shadow.camera.top = 18;
  moonlight.shadow.camera.bottom = -12;
  moonlight.shadow.camera.near = 1;
  moonlight.shadow.camera.far = 55;
  moonlight.shadow.bias = -0.0004;
  moonlight.shadow.normalBias = 0.035;
  scene.add(moonlight);
  scene.add(moonlight.target);

  const rimLight = new THREE.DirectionalLight(0x7897a5, 0.68);
  rimLight.position.set(-12, 7, 12);
  scene.add(rimLight);

  /* -----------------------------------------------------------
     Procedural textures
     ----------------------------------------------------------- */

  function canvasTexture(canvasEl, colorSpace) {
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.colorSpace = colorSpace || THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  function makeGlowTexture(size = 128) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.12, "rgba(255,255,255,0.92)");
    g.addColorStop(0.3, "rgba(255,255,255,0.38)");
    g.addColorStop(0.62, "rgba(255,255,255,0.08)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvasTexture(c);
  }

  function makeStarTexture(size = 96) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,247,220,0.7)");
    g.addColorStop(0.55, "rgba(255,247,220,0.08)");
    g.addColorStop(1, "rgba(255,247,220,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(255,250,235,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2, 5);
    ctx.lineTo(size / 2, size - 5);
    ctx.moveTo(5, size / 2);
    ctx.lineTo(size - 5, size / 2);
    ctx.stroke();
    return canvasTexture(c);
  }

  function makeRainTexture() {
    const c = document.createElement("canvas");
    c.width = 24;
    c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.22, "rgba(220,240,248,0.75)");
    g.addColorStop(0.75, "rgba(220,240,248,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(10, 0, 3.5, 128);
    return canvasTexture(c);
  }

  function makeMoonTexture() {
    const c = document.createElement("canvas");
    c.width = 768;
    c.height = 384;
    const ctx = c.getContext("2d");

    const base = ctx.createLinearGradient(0, 0, 0, 384);
    base.addColorStop(0, "#fff9e4");
    base.addColorStop(0.55, "#f3e6c5");
    base.addColorStop(1, "#d9c8a2");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 768, 384);

    const glow = ctx.createRadialGradient(300, 160, 10, 300, 160, 240);
    glow.addColorStop(0, "rgba(255,253,237,0.65)");
    glow.addColorStop(0.6, "rgba(255,247,218,0.12)");
    glow.addColorStop(1, "rgba(255,247,218,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 768, 384);

    for (let i = 0; i < 24; i++) {
      const x = random() * 768;
      const y = 20 + random() * 344;
      const r = 5 + random() * 24;
      ctx.fillStyle = `rgba(163,149,116,${0.055 + random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.25, r, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvasTexture(c);
  }

  function makeMistTexture() {    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < 28; i++) {
      const x = rng(40, 472);
      const y = rng(70, 210);
      const r = rng(35, 95);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.075)");
      g.addColorStop(0.55, "rgba(255,255,255,0.035)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function makeShingleTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#35463d";
    ctx.fillRect(0, 0, 512, 512);

    for (let y = 0; y < 512; y += 39) {
      ctx.strokeStyle = "rgba(8,16,13,0.52)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();

      const offset = (Math.floor(y / 39) % 2) * 38;
      for (let x = -30; x < 540; x += 76) {
        ctx.strokeStyle = "rgba(10,20,16,0.28)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x + offset, y + 2);
        ctx.lineTo(x + offset, y + 39);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(145,160,125,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 8);
      ctx.lineTo(512, y + 8);
      ctx.stroke();
    }

    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = `rgba(${80 + random() * 40},${100 + random() * 40},${80 + random() * 35},${0.03 + random() * 0.06})`;
      const x = random() * 512;
      const y = random() * 512;
      ctx.beginPath();
      ctx.ellipse(x, y, 5 + random() * 26, 2 + random() * 8, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = canvasTexture(c);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.4, 1.5);
    return texture;
  }

  function makeWindowTexture() {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext("2d");

    const base = ctx.createLinearGradient(0, 0, 0, 512);
    base.addColorStop(0, "#fff1ce");
    base.addColorStop(0.55, "#f4d59b");
    base.addColorStop(1, "#d5a264");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 512);

    const innerGlow = ctx.createRadialGradient(260, 205, 10, 260, 240, 280);
    innerGlow.addColorStop(0, "rgba(255,252,224,0.78)");
    innerGlow.addColorStop(0.45, "rgba(255,236,181,0.24)");
    innerGlow.addColorStop(1, "rgba(126,72,35,0)");
    ctx.fillStyle = innerGlow;
    ctx.fillRect(0, 0, 512, 512);

    // Soft curtain folds at the edges
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side === -1 ? 0 : 512, 0);
      ctx.scale(side, 1);
      ctx.fillStyle = "rgba(67,39,24,0.5)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(48, 90, 22, 165, 42, 258);
      ctx.bezierCurveTo(55, 330, 25, 426, 46, 512);
      ctx.lineTo(0, 512);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(239,198,135,0.19)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(15 + i * 11, 4);
        ctx.bezierCurveTo(37 + i * 9, 100, 20 + i * 10, 200, 36 + i * 9, 390);
        ctx.stroke();
      }
      ctx.restore();
    }

    // A little porcelain cup silhouette resting on the sill
    ctx.fillStyle = "rgba(68,41,26,0.3)";
    ctx.beginPath();
    ctx.ellipse(320, 420, 32, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(300, 392, 40, 27);
    ctx.beginPath();
    ctx.arc(341, 405, 11, -1.3, 1.3);
    ctx.strokeStyle = "rgba(68,41,26,0.3)";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Gentle darkened corners
    const corners = ctx.createRadialGradient(256, 250, 110, 256, 250, 370);
    corners.addColorStop(0, "rgba(55,29,16,0)");
    corners.addColorStop(0.72, "rgba(55,29,16,0.04)");
    corners.addColorStop(1, "rgba(40,21,12,0.34)");
    ctx.fillStyle = corners;
    ctx.fillRect(0, 0, 512, 512);

    return canvasTexture(c);
  }

  function makeSignTexture() {    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 240;
    const ctx = c.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, 640, 240);
    bg.addColorStop(0, "#47301e");
    bg.addColorStop(0.5, "#593b25");
    bg.addColorStop(1, "#3d291a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 640, 240);

    ctx.strokeStyle = "rgba(229,197,141,0.28)";
    ctx.lineWidth = 3;
    ctx.strokeRect(13, 13, 614, 214);
    ctx.strokeStyle = "rgba(17,11,7,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(22, 22, 596, 196);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ead9b3";
    ctx.font = '600 76px "Songti SC", "STSong", "SimSun", serif';
    ctx.fillText("雾杉小屋", 320, 118);

    ctx.fillStyle = "rgba(231,210,167,0.66)";
    ctx.font = '500 22px "Segoe UI", "PingFang SC", sans-serif';
    ctx.fillText("MISTPINE  ·  CABIN 07", 320, 169);

    for (const [x, y] of [[44, 44], [596, 44], [44, 196], [596, 196]]) {
      ctx.fillStyle = "rgba(230,205,159,0.42)";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvasTexture(c);
  }

  const glowTexture = makeGlowTexture();
  const starTexture = makeStarTexture();
  const rainTexture = makeRainTexture();
  const mistTexture = makeMistTexture();
  const shingleTexture = makeShingleTexture();
  const signTexture = makeSignTexture();
  const windowTexture = makeWindowTexture();
  const moonTexture = makeMoonTexture();

  function addGlowSprite(parent, color, scale, opacity, x, y, z) {
    const material = new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale, 1);
    sprite.userData.baseOpacity = opacity;
    parent.add(sprite);
    return sprite;
  }

  /* -----------------------------------------------------------
     Sky, stars and moon
     ----------------------------------------------------------- */

  const skyGeometry = new THREE.SphereGeometry(92, 40, 24);
  {
    const positions = skyGeometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const top = new THREE.Color(0x091a28);
    const mid = new THREE.Color(0x20464d);
    const horizon = new THREE.Color(0x89735f);
    const low = new THREE.Color(0x0b1714);
    const temp = new THREE.Color();

    for (let i = 0; i < positions.count; i++) {
      const h = positions.getY(i) / 92;
      if (h <= -0.02) {
        temp.copy(horizon).lerp(low, smoothstep(-0.02, -0.45, h));
      } else if (h < 0.25) {
        temp.copy(horizon).lerp(mid, smoothstep(-0.02, 0.25, h));
      } else {
        temp.copy(mid).lerp(top, smoothstep(0.25, 0.92, h));
      }
      colors[i * 3] = temp.r;
      colors[i * 3 + 1] = temp.g;
      colors[i * 3 + 2] = temp.b;
    }

    skyGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  const sky = new THREE.Mesh(
    skyGeometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false
    })
  );
  sky.renderOrder = -30;
  scene.add(sky);

  addGlowSprite(scene, 0xd99b78, 64, 0.15, -34, 8, -53);
  addGlowSprite(scene, 0x839cae, 34, 0.08, 30, 16, -46);

  // The moon is a real object in the scene, sitting inside the sky dome.
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(2.05, 32, 24),
    new THREE.MeshBasicMaterial({
      map: moonTexture,
      color: 0xfffdf2,
      fog: false,
      toneMapped: false
    })
  );
  moon.position.set(-5.5, 11.0, -46);
  moon.rotation.set(0.12, 0.48, -0.08);
  scene.add(moon);

  const moonHalo = addGlowSprite(scene, 0xf7e5b5, 12.5, 0.34, -5.5, 11.0, -46.2);
  const moonHaloOuter = addGlowSprite(scene, 0xd8c79c, 24, 0.075, -5.5, 11.0, -46.4);

  const starCount = isCompact ? 450 : 950;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  const starColorA = new THREE.Color(0xfff1cf);
  const starColorB = new THREE.Color(0xbfd6e2);
  const starTemp = new THREE.Color();

  for (let i = 0; i < starCount; i++) {
    const phi = random() * Math.PI * 2;
    const h = 0.03 + random() * 0.94;
    const horizontal = Math.sqrt(1 - h * h);
    const radius = 58 + random() * 24;
    starPositions[i * 3] = Math.cos(phi) * horizontal * radius;
    starPositions[i * 3 + 1] = h * radius;
    starPositions[i * 3 + 2] = Math.sin(phi) * horizontal * radius;

    starTemp.copy(starColorA).lerp(starColorB, random() * 0.75);
    const brightness = 0.45 + random() * 0.55;
    starColors[i * 3] = starTemp.r * brightness;
    starColors[i * 3 + 1] = starTemp.g * brightness;
    starColors[i * 3 + 2] = starTemp.b * brightness;
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
  const starMaterial = new THREE.PointsMaterial({
    size: 0.36,
    map: starTexture,
    transparent: true,
    opacity: 0.88,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: false,
    toneMapped: false
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.renderOrder = -20;
  scene.add(stars);

  /* Occasional shooting star */
  const shootingMaterial = new THREE.SpriteMaterial({
    map: starTexture,
    color: 0xfff2cd,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false
  });
  const shootingStar = new THREE.Sprite(shootingMaterial);
  shootingStar.scale.set(4.2, 0.2, 1);
  shootingStar.visible = false;
  scene.add(shootingStar);
  let nextShootingStar = 8 + random() * 14;
  let shootingProgress = -1;

  /* -----------------------------------------------------------
     Terrain
     ----------------------------------------------------------- */

  function groundHeight(x, z) {
    const radius = Math.hypot(x, z);
    const clearing = smoothstep(4.4, 11.5, radius);
    const main =
      Math.sin(x * 0.29) * 0.32 +
      Math.cos(z * 0.24 + 0.4) * 0.26 +
      Math.sin((x + z) * 0.51) * 0.11;
    const far = radius > 16 ? Math.sin(x * 0.12 + z * 0.16) * 0.34 : 0;
    return clearing * (main + far);
  }

  const groundGeometry = new THREE.PlaneGeometry(72, 72, 96, 96);
  groundGeometry.rotateX(-Math.PI / 2);

  {
    const positions = groundGeometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const grassA = new THREE.Color(0x1d3325);
    const grassB = new THREE.Color(0x355438);
    const grassC = new THREE.Color(0x49623e);
    const grassD = new THREE.Color(0x253b2a);
    const tempColor = new THREE.Color();

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = groundHeight(x, z);
      positions.setY(i, y);

      const mix = (Math.sin(x * 0.7 + z * 0.9) + Math.sin(x * 0.19 - z * 0.31 + 2.1) + 2) / 4;
      tempColor.copy(grassA).lerp(grassB, mix * 0.85);
      if (mix > 0.58) tempColor.lerp(grassC, (mix - 0.58) * 1.4);
      if (mix < 0.24) tempColor.lerp(grassD, 0.38);
      const distanceFade = clamp(Math.hypot(x, z) / 48, 0, 1);
      tempColor.multiplyScalar(1 - distanceFade * 0.23);

      colors[i * 3] = tempColor.r;
      colors[i * 3 + 1] = tempColor.g;
      colors[i * 3 + 2] = tempColor.b;
    }

    groundGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    groundGeometry.computeVertexNormals();
  }

  const ground = new THREE.Mesh(
    groundGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      flatShading: true
    })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  /* Soft low ground mist */
  const mistPlanes = [];
  for (let i = 0; i < 4; i++) {
    const material = new THREE.MeshBasicMaterial({
      map: mistTexture,
      color: 0x9db6a7,
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(32, 18), material);
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.z = rng(-0.4, 0.4);
    plane.position.set(rng(-7, 7), 0.18 + i * 0.035, -8 + i * 5.2);
    plane.renderOrder = 2;
    plane.userData.phase = rng(0, Math.PI * 2);
    plane.userData.baseX = plane.position.x;
    scene.add(plane);
    mistPlanes.push(plane);
  }

  addGlowSprite(scene, 0x9cb2a7, 48, 0.055, -6, 3, -29);

  /* -----------------------------------------------------------
     Reusable cabin materials
     ----------------------------------------------------------- */

  const matLogDark = new THREE.MeshStandardMaterial({
    color: 0x4a3222,
    roughness: 0.98,
    metalness: 0,
    flatShading: true
  });
  const matLog = new THREE.MeshStandardMaterial({
    color: 0x704c31,
    roughness: 0.96,
    metalness: 0,
    flatShading: true
  });
  const matLogLight = new THREE.MeshStandardMaterial({
    color: 0x8a5d3c,
    roughness: 0.94,
    metalness: 0,
    flatShading: true
  });
  const matDoor = new THREE.MeshStandardMaterial({
    color: 0x91603e,
    roughness: 0.9,
    metalness: 0,
    flatShading: true
  });
  const matStone = new THREE.MeshStandardMaterial({
    color: 0x62685c,
    roughness: 1,
    metalness: 0,
    flatShading: true
  });
  const matRoof = new THREE.MeshStandardMaterial({
    map: shingleTexture,
    color: 0xdfe3d4,
    roughness: 0.98,
    metalness: 0,
    flatShading: true
  });
  const matSnow = new THREE.MeshStandardMaterial({
    color: 0xe3ebe8,
    emissive: 0x617983,
    emissiveIntensity: 0.4,
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const matBrass = new THREE.MeshStandardMaterial({
    color: 0xb69055,
    roughness: 0.42,
    metalness: 0.7
  });
  const matIron = new THREE.MeshStandardMaterial({
    color: 0x242b27,
    roughness: 0.72,
    metalness: 0.2
  });
  const matGreen = new THREE.MeshStandardMaterial({
    color: 0x3d5633,
    roughness: 0.96,
    flatShading: true
  });

  const windowGlassMaterial = new THREE.MeshBasicMaterial({
    map: windowTexture,
    color: 0x26322b,
    toneMapped: false
  });
  const lanternMaterial = new THREE.MeshBasicMaterial({
    color: 0x372b1d,
    toneMapped: false
  });

  const windowGlows = [];
  const warmColor = new THREE.Color(0xffc06a);
  const windowOffColor = new THREE.Color(0x24312a);
  const lanternWarmColor = new THREE.Color(0xffd68a);
  const lanternOffColor = new THREE.Color(0x392d1f);

  function addBox(parent, material, width, height, depth, x, y, z, castShadow = true, receiveShadow = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    parent.add(mesh);
    return mesh;
  }

  function addCylinder(parent, material, radiusTop, radiusBottom, height, segments, x, y, z) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
      material
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /* -----------------------------------------------------------
     Cabin
     ----------------------------------------------------------- */

  const cabin = new THREE.Group();
  cabin.position.set(0, 0, 0);
  scene.add(cabin);

  const windowHitboxes = [];
  let doorPivot;
  let doorSpill;
  let interiorLight;
  let porchLight;
  let facadeLight;
  let porchPool;
  let catTail;
  let catHead;

  function buildCabin() {
    // Stone foundation
    addBox(cabin, matStone, 6.8, 0.46, 5.15, 0, 0.23, 0);
    for (let i = 0; i < 10; i++) {
      const x = -2.8 + i * 0.63;
      addBox(cabin, matStone, 0.54, 0.22, 0.34, x, 0.22, 2.53, false, true).rotation.z = rng(-0.05, 0.05);
    }

    // Main wall masses (front is split to leave a real doorway)
    const wallHeight = 3.12;
    const wallCenterY = 0.47 + wallHeight / 2;
    addBox(cabin, matLogDark, 6.0, wallHeight, 0.24, 0, wallCenterY, -2.29);
    addBox(cabin, matLogDark, 0.24, wallHeight, 4.56, -2.88, wallCenterY, 0);
    addBox(cabin, matLogDark, 0.24, wallHeight, 4.56, 2.88, wallCenterY, 0);
    addBox(cabin, matLogDark, 2.24, wallHeight, 0.24, -1.78, wallCenterY, 2.29);
    addBox(cabin, matLogDark, 2.24, wallHeight, 0.24, 1.78, wallCenterY, 2.29);
    addBox(cabin, matLogDark, 1.36, 0.98, 0.24, 0, 3.04, 2.29);

    // Rounded log courses
    const logGeoFull = new THREE.CylinderGeometry(0.145, 0.145, 6.06, 7);
    const logGeoSide = new THREE.CylinderGeometry(0.145, 0.145, 4.62, 7);
    const logGeoHalf = new THREE.CylinderGeometry(0.145, 0.145, 2.26, 7);

    for (let y = 0.59; y < 3.48; y += 0.286) {
      const variant = Math.floor((y - 0.59) / 0.286);
      const material = variant % 4 === 0 ? matLogLight : matLog;

      if (y < 2.58) {
        const left = new THREE.Mesh(logGeoHalf, material);
        left.rotation.z = Math.PI / 2;
        left.position.set(-1.78, y, 2.42);
        left.castShadow = true;
        left.receiveShadow = true;
        cabin.add(left);

        const right = new THREE.Mesh(logGeoHalf, material);
        right.rotation.z = Math.PI / 2;
        right.position.set(1.78, y, 2.42);
        right.castShadow = true;
        right.receiveShadow = true;
        cabin.add(right);
      } else {
        const front = new THREE.Mesh(logGeoFull, material);
        front.rotation.z = Math.PI / 2;
        front.position.set(0, y, 2.42);
        front.castShadow = true;
        front.receiveShadow = true;
        cabin.add(front);
      }

      const back = new THREE.Mesh(logGeoFull, material);
      back.rotation.z = Math.PI / 2;
      back.position.set(0, y, -2.42);
      back.castShadow = true;
      back.receiveShadow = true;
      cabin.add(back);

      for (const side of [-1, 1]) {
        const sideLog = new THREE.Mesh(logGeoSide, material);
        sideLog.rotation.x = Math.PI / 2;
        sideLog.position.set(side * 3.0, y, 0);
        sideLog.castShadow = true;
        sideLog.receiveShadow = true;
        cabin.add(sideLog);
      }
    }

    // Corner beams
    for (const x of [-3.01, 3.01]) {
      for (const z of [-2.42, 2.42]) {
        addBox(cabin, matLogDark, 0.27, 3.25, 0.27, x, 1.94, z);
      }
    }

    // Gable triangles
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-2.94, 0);
    gableShape.lineTo(2.94, 0);
    gableShape.lineTo(0, 1.6);
    gableShape.closePath();
    const gableGeometry = new THREE.ExtrudeGeometry(gableShape, {
      depth: 0.18,
      bevelEnabled: false
    });
    gableGeometry.translate(0, 0, -0.09);

    const frontGable = new THREE.Mesh(gableGeometry, matLogDark);
    frontGable.position.set(0, 3.52, 2.28);
    frontGable.castShadow = true;
    frontGable.receiveShadow = true;
    cabin.add(frontGable);

    const backGable = new THREE.Mesh(gableGeometry, matLogDark);
    backGable.position.set(0, 3.52, -2.28);
    backGable.rotation.y = Math.PI;
    backGable.castShadow = true;
    backGable.receiveShadow = true;
    cabin.add(backGable);

    // Gable planks
    for (let i = -5; i <= 5; i++) {
      const x = i * 0.49;
      const maxY = 3.52 + 1.58 * (1 - Math.abs(x) / 2.95);
      const plank = addBox(
        cabin,
        i % 2 === 0 ? matLog : matLogDark,
        0.035,
        Math.max(0.12, maxY - 3.55),
        0.025,
        x,
        3.55 + Math.max(0.12, maxY - 3.55) / 2,
        2.39,
        false,
        false
      );
      plank.castShadow = false;
    }

    // Roof
    const roofAngle = Math.atan2(1.63, 3.5);
    const roofGeometry = new THREE.BoxGeometry(4.36, 0.17, 5.82);
    const snowGeometry = roofGeometry.clone();

    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(roofGeometry, matRoof);
      panel.position.set(side * 1.82, 4.36, 0);
      panel.rotation.z = side * -roofAngle;
      panel.castShadow = true;
      panel.receiveShadow = true;
      cabin.add(panel);

      const snow = new THREE.Mesh(snowGeometry, matSnow);
      snow.position.set(side * 1.82, 4.48, 0);
      snow.rotation.z = side * -roofAngle;
      snow.scale.set(1.015, 1, 1.015);
      snow.castShadow = false;
      snow.receiveShadow = true;
      snow.renderOrder = 3;
      cabin.add(snow);
    }

    addCylinder(cabin, matLogDark, 0.14, 0.14, 5.92, 7, 0, 5.2, 0).rotation.x = Math.PI / 2;

    for (const side of [-1, 1]) {
      addBox(cabin, matLogDark, 0.16, 0.23, 5.9, side * 3.6, 3.52, 0);
    }

    // Moss patches on the roof
    const mossMaterial = new THREE.MeshStandardMaterial({
      color: 0x50633d,
      roughness: 1,
      flatShading: true
    });
    for (let i = 0; i < 9; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const x = side * rng(1.0, 3.1);
      const z = rng(-2.3, 2.3);
      const y = 5.16 - Math.abs(x) * (1.63 / 3.5) + 0.11;
      const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(rng(0.16, 0.36), 0), mossMaterial);
      moss.position.set(x, y, z);
      moss.scale.set(1.5, 0.22, 1.2);
      moss.rotation.y = rng(0, Math.PI);
      moss.castShadow = false;
      cabin.add(moss);
    }

    // Chimney
    addBox(cabin, matStone, 0.93, 2.55, 0.93, -1.85, 4.35, -0.92);
    addBox(cabin, matStone, 1.13, 0.17, 1.13, -1.85, 5.67, -0.92);
    for (let i = 0; i < 5; i++) {
      addBox(
        cabin,
        matStone,
        rng(0.2, 0.34),
        rng(0.13, 0.23),
        0.12,
        -1.85 + rng(-0.32, 0.32),
        3.8 + i * 0.37,
        -0.43,
        false,
        true
      );
    }

    // Round gable window
    const gableGlow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), windowGlassMaterial);
    gableGlow.position.set(0, 4.17, 2.405);
    cabin.add(gableGlow);
    const gableFrame = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 6, 20), matLogDark);
    gableFrame.position.set(0, 4.17, 2.43);
    cabin.add(gableFrame);
    addBox(cabin, matLogDark, 0.04, 0.54, 0.04, 0, 4.17, 2.44, false, false);
    addBox(cabin, matLogDark, 0.54, 0.04, 0.04, 0, 4.17, 2.44, false, false);
    windowGlows.push(addGlowSprite(cabin, 0xffbd66, 1.7, 0.24, 0, 4.17, 2.74));

    // Sign above door
    const signBoard = addBox(cabin, matLogDark, 1.78, 0.67, 0.08, 0, 2.97, 2.58);
    signBoard.castShadow = false;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.64, 0.57),
      new THREE.MeshBasicMaterial({ map: signTexture, toneMapped: false })
    );
    sign.position.set(0, 2.97, 2.625);
    cabin.add(sign);

    // Windows
    createWindow(-1.76, 2.11, 2.6);
    createWindow(1.76, 2.11, 2.6);

    // Door frame + hinged door
    addBox(cabin, matLogDark, 0.15, 2.31, 0.17, -0.75, 1.59, 2.54);
    addBox(cabin, matLogDark, 0.15, 2.31, 0.17, 0.75, 1.59, 2.54);
    addBox(cabin, matLogDark, 1.64, 0.16, 0.18, 0, 2.73, 2.54);
    addBox(cabin, matLogDark, 1.53, 0.1, 0.24, 0, 0.47, 2.54);

    doorPivot = new THREE.Group();
    doorPivot.position.set(-0.65, 0.45, 2.58);
    cabin.add(doorPivot);

    const doorPanelGroup = new THREE.Group();
    doorPivot.add(doorPanelGroup);

    const plankColors = [0x855535, 0x7a4c2e, 0x8c5c3a];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: plankColors[i % plankColors.length],
        roughness: 0.9,
        flatShading: true
      });
      addBox(doorPanelGroup, mat, 0.325, 2.06, 0.12, 0.17 + i * 0.327, 1.06, 0);
    }

    addBox(doorPanelGroup, matLogDark, 1.32, 0.1, 0.14, 0.66, 0.36, 0.02);
    addBox(doorPanelGroup, matLogDark, 1.32, 0.1, 0.14, 0.66, 1.76, 0.02);
    const brace = addBox(doorPanelGroup, matLogDark, 1.45, 0.08, 0.03, 0.66, 1.03, 0.075, false, false);
    brace.rotation.z = 0.92;

    const doorWindow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.235, 0.235, 0.11, 18),
      windowGlassMaterial
    );
    doorWindow.rotation.x = Math.PI / 2;
    doorWindow.position.set(0.66, 1.47, 0.09);
    doorPanelGroup.add(doorWindow);

    const doorWindowRing = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 6, 18), matLogDark);
    doorWindowRing.position.set(0.66, 1.47, 0.16);
    doorPanelGroup.add(doorWindowRing);

    const handlePlate = addBox(doorPanelGroup, matBrass, 0.16, 0.24, 0.035, 1.13, 1.02, 0.09, false, false);
    handlePlate.rotation.z = 0.02;
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 8), matBrass);
    handle.position.set(1.13, 1.01, 0.15);
    handle.castShadow = true;
    doorPanelGroup.add(handle);

    // Pale light spilling over the porch when the door opens
    doorSpill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 2.4),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: 0xffb962,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );
    doorSpill.rotation.x = -Math.PI / 2;
    doorSpill.position.set(0, 0.49, 3.6);
    doorSpill.renderOrder = 4;
    cabin.add(doorSpill);

    porchPool = new THREE.Mesh(
      new THREE.PlaneGeometry(8.5, 5.4),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: 0xffb86b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false
      })
    );
    porchPool.rotation.x = -Math.PI / 2;
    porchPool.position.set(0, 0.54, 4.6);
    porchPool.renderOrder = 3;
    cabin.add(porchPool);

    // Porch deck
    addBox(cabin, matLogDark, 3.25, 0.15, 1.58, 0, 0.41, 3.18);
    for (let i = 0; i < 5; i++) {
      addBox(
        cabin,
        i % 2 === 0 ? matLog : matLogLight,
        0.6,
        0.035,
        1.5,
        -1.26 + i * 0.63,
        0.505,
        3.18,
        false,
        true
      );
    }
    addBox(cabin, matLogDark, 2.2, 0.17, 0.38, 0, 0.28, 4.08);
    addBox(cabin, matLogDark, 2.2, 0.15, 0.34, 0, 0.13, 4.4);

    const matWelcome = new THREE.MeshStandardMaterial({ color: 0x7b5c40, roughness: 1 });
    const matWelcomeDark = new THREE.MeshStandardMaterial({ color: 0x4f3b2b, roughness: 1 });
    addBox(cabin, matWelcome, 0.88, 0.025, 0.54, 0, 0.53, 3.38, false, true);
    addBox(cabin, matWelcomeDark, 0.74, 0.012, 0.4, 0, 0.546, 3.38, false, true);

    // Porch lantern posts
    for (const side of [-1, 1]) {
      addBox(cabin, matLogDark, 0.09, 1.16, 0.09, side * 1.36, 1.0, 3.55);
      addBox(cabin, matLogDark, 0.31, 0.07, 0.22, side * 1.36, 1.61, 3.55);
      const lantern = addBox(cabin, lanternMaterial, 0.2, 0.27, 0.2, side * 1.36, 1.43, 3.55, false, false);
      lantern.castShadow = false;
      windowGlows.push(addGlowSprite(cabin, 0xffd68b, 1.15, 0.34, side * 1.36, 1.42, 3.64));
    }

    porchLight = new THREE.PointLight(0xffae60, 0.85, 4.2, 2);
    porchLight.position.set(1.2, 1.5, 3.7);
    cabin.add(porchLight);

    facadeLight = new THREE.PointLight(0xffa45a, 0, 12, 2);
    facadeLight.position.set(-0.2, 2.35, 6.2);
    cabin.add(facadeLight);

    // Woodpile
    const logPieceGeo = new THREE.CylinderGeometry(0.16, 0.17, 1.12, 7);
    for (let i = 0; i < 5; i++) {
      const log = new THREE.Mesh(logPieceGeo, i % 2 === 0 ? matLog : matLogLight);
      log.rotation.x = Math.PI / 2;
      log.position.set(-3.55 + (i % 3) * 0.34, 0.18 + Math.floor(i / 2) * 0.3, 2.62 - Math.floor(i / 2) * 0.06);
      log.rotation.z = rng(-0.06, 0.06);
      log.castShadow = true;
      log.receiveShadow = true;
      cabin.add(log);
    }
    addCylinder(cabin, matLogDark, 0.3, 0.36, 0.48, 8, -4.05, 0.24, 3.12);

    // Window flower boxes
    createFlowerBox(-1.76, 1.42, 2.76);
    createFlowerBox(1.76, 1.42, 2.76);

    // A small black cat on the porch
    buildCat(1.02, 0.53, 3.12);

    // Interior room, visible when the door swings open
    buildInterior();

    // Invisible interaction volumes
    addHitbox(cabin, "door", 1.7, 2.5, 0.55, 0, 1.55, 2.8);
    addHitbox(cabin, "lights", 1.5, 1.42, 0.42, -1.76, 2.11, 2.8);
    addHitbox(cabin, "lights", 1.5, 1.42, 0.42, 1.76, 2.11, 2.8);
  }

  function createWindow(x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    cabin.add(g);

    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.08, 1.03, 0.07), windowGlassMaterial);
    glass.position.z = 0.02;
    g.add(glass);

    addBox(g, matLogDark, 1.34, 0.13, 0.16, 0, 0.6, 0.09);
    addBox(g, matLogDark, 1.34, 0.13, 0.16, 0, -0.6, 0.09);
    addBox(g, matLogDark, 0.13, 1.3, 0.16, -0.61, 0, 0.09);
    addBox(g, matLogDark, 0.13, 1.3, 0.16, 0.61, 0, 0.09);

    addBox(g, matLogDark, 0.055, 1.02, 0.055, 0, 0, 0.15, false, false);
    addBox(g, matLogDark, 1.06, 0.055, 0.055, 0, 0, 0.15, false, false);

    for (const side of [-1, 1]) {
      const shutter = addBox(g, matLogLight, 0.32, 1.23, 0.07, side * 0.84, 0, 0.06);
      shutter.rotation.y = side * -0.05;
      for (let i = -1; i <= 1; i++) {
        addBox(g, matLogDark, 0.26, 0.035, 0.02, side * 0.84, i * 0.34, 0.105, false, false);
      }
    }

    const box = addBox(g, matGreen, 1.36, 0.23, 0.35, 0, -0.8, 0.24);
    box.castShadow = true;
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rng(0.06, 0.12), 0),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? 0x3d5a34 : 0x4f693d,
          roughness: 1,
          flatShading: true
        })
      );
      leaf.position.set(-0.58 + i * 0.19, -0.65 + rng(-0.04, 0.08), 0.35);
      leaf.castShadow = false;
      g.add(leaf);
    }
    for (let i = 0; i < 4; i++) {
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 6, 4),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xe9bd76 : 0xd8876b, toneMapped: false })
      );
      flower.position.set(-0.46 + i * 0.3, -0.58 + rng(0, 0.1), 0.4);
      g.add(flower);
    }

    windowGlows.push(addGlowSprite(cabin, 0xffbb62, 2.9, 0.31, x, y, z + 0.62));
  }

  function createFlowerBox(x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    cabin.add(g);
    const planter = addBox(g, matLogLight, 0.9, 0.21, 0.3, 0, 0, 0);
    planter.castShadow = true;
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.22 + rng(0, 0.12), 4),
        new THREE.MeshStandardMaterial({ color: 0x3f5b35, flatShading: true, roughness: 1 })
      );
      leaf.position.set(-0.34 + i * 0.17, 0.16, 0.02);
      leaf.rotation.z = rng(-0.25, 0.25);
      g.add(leaf);
    }
  }

  function buildInterior() {
    const room = new THREE.Group();
    room.position.set(0, 0, 0);
    cabin.add(room);

    const matWall = new THREE.MeshStandardMaterial({ color: 0x815c3f, roughness: 1 });
    const matFloor = new THREE.MeshStandardMaterial({ color: 0x5b3d29, roughness: 1 });
    const matRug = new THREE.MeshStandardMaterial({ color: 0x753c34, roughness: 1 });
    const matFurniture = new THREE.MeshStandardMaterial({
      color: 0x4f3323,
      roughness: 0.95,
      flatShading: true
    });

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.45), matWall);
    backWall.position.set(0, 1.65, 0.88);
    backWall.receiveShadow = true;
    room.add(backWall);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.7), matFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.49, 1.62);
    floor.receiveShadow = true;
    room.add(floor);

    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.15), matRug);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.1, 0.505, 1.73);
    room.add(rug);

    const rugBorder = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 0.86),
      new THREE.MeshBasicMaterial({ color: 0x9b7250, transparent: true, opacity: 0.4 })
    );
    rugBorder.rotation.x = -Math.PI / 2;
    rugBorder.position.set(0.1, 0.512, 1.73);
    room.add(rugBorder);

    // Little table and lamp
    addCylinder(room, matFurniture, 0.34, 0.38, 0.06, 12, -0.55, 0.91, 1.35);
    addCylinder(room, matFurniture, 0.055, 0.07, 0.44, 7, -0.55, 0.69, 1.35);
    const lampBase = addCylinder(room, matIron, 0.08, 0.1, 0.08, 8, -0.55, 0.98, 1.35);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.27, 0.28, 10, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xffc97b,
        emissive: 0xff9b42,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        toneMapped: false
      })
    );
    shade.position.set(-0.55, 1.2, 1.35);
    room.add(shade);
    addGlowSprite(room, 0xffb34e, 1.1, 0.28, -0.55, 1.18, 1.48);

    // Armchair
    addBox(room, matFurniture, 0.72, 0.4, 0.55, 0.72, 0.69, 1.35);
    addBox(room, matFurniture, 0.72, 0.66, 0.14, 0.72, 0.99, 1.11);
    addBox(room, matFurniture, 0.15, 0.36, 0.55, 0.42, 0.72, 1.35);
    addBox(room, matFurniture, 0.15, 0.36, 0.55, 1.02, 0.72, 1.35);

    // Shelf and tiny framed picture
    addBox(room, matFurniture, 1.05, 0.07, 0.22, -1.35, 1.65, 1.02);
    for (let i = 0; i < 6; i++) {
      const bookColors = [0x8f5438, 0x536048, 0x9b7d4e, 0x5d4952];
      addBox(
        room,
        new THREE.MeshStandardMaterial({ color: bookColors[i % bookColors.length], roughness: 1 }),
        0.08,
        0.24 + (i % 3) * 0.04,
        0.16,
        -1.7 + i * 0.13,
        1.81,
        1.02,
        false,
        false
      );
    }
    const pictureFrame = addBox(room, matLogLight, 0.58, 0.44, 0.04, 0.92, 1.95, 0.91, false, false);
    pictureFrame.castShadow = false;
    const picture = new THREE.Mesh(
      new THREE.PlaneGeometry(0.47, 0.34),
      new THREE.MeshBasicMaterial({ color: 0x8a9b7d, toneMapped: false })
    );
    picture.position.set(0.92, 1.95, 0.94);
    room.add(picture);

    // Pendant lamp
    addCylinder(room, matIron, 0.012, 0.012, 0.4, 5, 0.1, 2.47, 1.55);
    const pendant = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc875, toneMapped: false })
    );
    pendant.position.set(0.1, 2.26, 1.55);
    room.add(pendant);
    addGlowSprite(room, 0xffb35b, 1.5, 0.25, 0.1, 2.25, 1.6);

    interiorLight = new THREE.PointLight(0xffa95d, 0, 4.2, 2);
    interiorLight.position.set(0, 1.95, 1.55);
    room.add(interiorLight);
  }

  function buildCat(x, y, z) {
    const cat = new THREE.Group();
    cat.position.set(x, y, z);
    cat.rotation.y = -0.24;
    cabin.add(cat);

    const fur = new THREE.MeshStandardMaterial({
      color: 0x111713,
      roughness: 0.94,
      flatShading: true
    });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 7), fur);
    body.scale.set(0.92, 1.3, 0.8);
    body.position.y = 0.24;
    body.castShadow = true;
    cat.add(body);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), fur);
    head.position.set(0, 0.54, 0.08);
    head.scale.set(1.0, 0.94, 1.0);
    head.castShadow = true;
    cat.add(head);
    catHead = head;

    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.15, 3), fur);
      ear.position.set(side * 0.09, 0.68, 0.08);
      ear.rotation.z = side * 0.18;
      ear.castShadow = true;
      cat.add(ear);

      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xefc66e, toneMapped: false })
      );
      eye.position.set(side * 0.058, 0.56, 0.205);
      cat.add(eye);
    }

    const nose = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0x8b5d4d, toneMapped: false })
    );
    nose.position.set(0, 0.51, 0.235);
    cat.add(nose);

    catTail = new THREE.Group();
    catTail.position.set(0.08, 0.2, -0.18);
    cat.add(catTail);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.22, 0.08, -0.05),
      new THREE.Vector3(0.34, 0.28, -0.18),
      new THREE.Vector3(0.28, 0.42, -0.34)
    ]);
    const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.026, 5, false), fur);
    tail.castShadow = true;
    catTail.add(tail);

    addGlowSprite(cat, 0xffd082, 0.55, 0.08, 0, 0.55, 0.15);
  }

  const interactables = [];

  function addHitbox(parent, action, width, height, depth, x, y, z) {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.userData.interact = action;
    parent.add(mesh);
    interactables.push(mesh);
    return mesh;
  }

  buildCabin();

  /* -----------------------------------------------------------
     Campfire
     ----------------------------------------------------------- */

  const fire = new THREE.Group();
  fire.position.set(isCompact ? 4.05 : 4.95, 0, isCompact ? 3.7 : 3.1);
  fire.scale.setScalar(isCompact ? 0.84 : 0.94);
  scene.add(fire);

  const fireLight = new THREE.PointLight(0xff8a3f, 0, 9, 2);
  fireLight.position.set(0, 1.2, 0);
  fire.add(fireLight);

  const fireGlow = addGlowSprite(fire, 0xff8a3a, 5.4, 0.32, 0, 0.9, 0.1);

  const fireGroundGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(6.8, 6.8),
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      color: 0xff8a42,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false
    })
  );
  fireGroundGlow.rotation.x = -Math.PI / 2;
  fireGroundGlow.position.y = 0.08;
  fireGroundGlow.renderOrder = 3;
  fire.add(fireGroundGlow);
  fire.userData.groundGlow = fireGroundGlow;

  function cylinderBetween(parent, start, end, radius, material, segments = 7) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const geo = new THREE.CylinderGeometry(radius, radius, length, segments);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(start).addScaledVector(direction, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function buildFire() {
    const stoneGeo = new THREE.DodecahedronGeometry(0.26, 0);
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const stone = new THREE.Mesh(stoneGeo, matStone);
      stone.position.set(Math.cos(angle) * 0.78, 0.14 + rng(-0.02, 0.05), Math.sin(angle) * 0.78);
      stone.scale.set(rng(0.8, 1.2), rng(0.55, 0.85), rng(0.8, 1.15));
      stone.rotation.set(rng(0, 1), rng(0, 3), rng(0, 1));
      stone.castShadow = true;
      stone.receiveShadow = true;
      fire.add(stone);
    }

    const emberMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a1d14,
      emissive: 0x3a1405,
      emissiveIntensity: 0.25,
      roughness: 1
    });

    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.22, 7), emberMaterial);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i / 4) * Math.PI;
      log.position.y = 0.2 + (i % 2) * 0.05;
      log.castShadow = true;
      fire.add(log);
    }

    const flameGroup = new THREE.Group();
    flameGroup.position.y = 0.25;
    fire.add(flameGroup);
    fire.userData.flameGroup = flameGroup;

    const flames = [];
    const flameSettings = [
      { radius: 0.43, height: 1.4, color: 0xff7b2f, opacity: 0.75, y: 0.62, seed: 0.0 },
      { radius: 0.3, height: 1.06, color: 0xffb13d, opacity: 0.82, y: 0.53, seed: 1.8 },
      { radius: 0.17, height: 0.7, color: 0xffe39b, opacity: 0.9, y: 0.4, seed: 3.2 }
    ];

    for (const setting of flameSettings) {
      const mat = new THREE.MeshBasicMaterial({
        color: setting.color,
        transparent: true,
        opacity: setting.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(setting.radius, setting.height, 7, 1, true), mat);
      mesh.position.y = setting.y;
      mesh.userData.seed = setting.seed;
      mesh.userData.baseY = setting.y;
      flameGroup.add(mesh);
      flames.push(mesh);
    }
    fire.userData.flames = flames;

    // Little tripod and kettle
    const tripodTop = new THREE.Vector3(0, 2.0, 0.08);
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + 0.4;
      cylinderBetween(
        fire,
        new THREE.Vector3(Math.cos(angle) * 0.62, 0, Math.sin(angle) * 0.62),
        tripodTop,
        0.025,
        matIron,
        5
      );
    }
    addCylinder(fire, matIron, 0.17, 0.2, 0.25, 8, 0, 1.72, 0.08);
    const kettleHandle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 5, 12, Math.PI), matIron);
    kettleHandle.position.set(0, 1.93, 0.08);
    kettleHandle.rotation.z = Math.PI;
    fire.add(kettleHandle);

    // Log seats
    for (const seat of [{ x: 1.62, z: 0.2, r: 0.2 }, { x: -0.35, z: 1.55, r: -0.7 }]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 1.1, 7), matLog);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = seat.r;
      log.position.set(seat.x, 0.26, seat.z);
      log.castShadow = true;
      log.receiveShadow = true;
      fire.add(log);
    }

    // Fireflies of ember
    const sparkCount = isCompact ? 42 : 70;
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkData = [];
    for (let i = 0; i < sparkCount; i++) {
      const data = {
        life: random(),
        speed: rng(0.4, 1.3),
        drift: rng(-0.2, 0.2),
        phase: rng(0, Math.PI * 2)
      };
      sparkData.push(data);
      sparkPositions[i * 3] = rng(-0.3, 0.3);
      sparkPositions[i * 3 + 1] = rng(0.4, 2.4);
      sparkPositions[i * 3 + 2] = rng(-0.3, 0.3);
    }
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
    const sparkMaterial = new THREE.PointsMaterial({
      size: 0.09,
      map: glowTexture,
      color: 0xffb45e,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
    sparks.frustumCulled = false;
    fire.add(sparks);
    fire.userData.sparks = sparks;
    fire.userData.sparkData = sparkData;
    fire.userData.sparkPositions = sparkPositions;

    addHitbox(fire, "fire", 2.65, 2.25, 2.65, 0, 1.0, 0);
  }

  buildFire();

  /* -----------------------------------------------------------
     Forest and undergrowth
     ----------------------------------------------------------- */

  const treeSway = [];
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a3e2b,
    roughness: 1,
    flatShading: true
  });
  const pineMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x153328, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x1d402f, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x244b36, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x2e573e, roughness: 1, flatShading: true })
  ];

  const pineConeGeometries = [
    new THREE.ConeGeometry(1.55, 1.05, 7, 1),
    new THREE.ConeGeometry(1.3, 1.02, 7, 1),
    new THREE.ConeGeometry(1.02, 0.98, 7, 1),
    new THREE.ConeGeometry(0.77, 0.9, 7, 1),
    new THREE.ConeGeometry(0.5, 0.78, 7, 1)
  ];
  const pineTrunkGeometry = new THREE.CylinderGeometry(0.15, 0.26, 1.28, 6);
  const pineTierY = [1.15, 1.79, 2.38, 2.91, 3.37];

  function createPine(x, z, scale, rotation, colorShift) {
    const group = new THREE.Group();
    group.position.set(x, groundHeight(x, z) - 0.04, z);
    group.rotation.y = rotation;
    group.scale.setScalar(scale);

    const trunk = new THREE.Mesh(pineTrunkGeometry, trunkMaterial);
    trunk.position.y = 0.62;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    for (let i = 0; i < 5; i++) {
      const material = pineMaterials[(i + colorShift) % pineMaterials.length];
      const cone = new THREE.Mesh(pineConeGeometries[i], material);
      cone.position.y = pineTierY[i];
      cone.rotation.y = rotation + i * 0.39;
      cone.castShadow = scale > 0.75;
      cone.receiveShadow = true;
      group.add(cone);
    }

    scene.add(group);
    treeSway.push({
      group,
      phase: rng(0, Math.PI * 2),
      strength: rng(0.002, 0.006)
    });
    return group;
  }

  const pineLayout = [
    [-11.2, -9.2, 1.95, 0.4, 1], [-8.4, -12.1, 2.2, 1.3, 2], [-5.8, -8.4, 1.55, 2.0, 0],
    [-2.7, -12.0, 1.82, 0.8, 1], [1.4, -12.8, 2.03, 2.7, 3], [5.1, -9.0, 1.72, 1.1, 0],
    [8.4, -11.1, 2.1, 0.2, 2], [12.0, -7.1, 1.63, 1.8, 1], [15.8, -12.6, 1.5, 0.5, 0],
    [-14.2, -3.4, 1.72, 2.5, 1], [-10.4, -4.2, 1.34, 1.2, 2], [-7.1, -2.3, 1.08, 0.3, 0],
    [10.0, -3.7, 1.56, 2.2, 1], [13.6, 0.1, 1.78, 0.9, 0], [8.3, 1.3, 1.21, 1.7, 2],
    [-13.1, 5.1, 1.58, 1.4, 2], [-9.6, 8.2, 1.42, 0.4, 1], [-6.9, 12.2, 1.3, 2.1, 0],
    [12.1, 6.6, 1.5, 1.9, 2], [9.2, 10.1, 1.24, 0.6, 1], [15.2, 10.2, 1.2, 2.4, 0],
    [16.6, -13.1, 1.5, 1.7, 2], [-17.2, -11.3, 1.59, 0.9, 0], [18.2, 2.2, 1.2, 2.8, 1],
    [-16.1, 10.2, 1.48, 1.1, 2], [-14.2, 13.7, 1.23, 0.4, 0],
    [6.4, -5.4, 0.94, 1.2, 2], [-4.7, -5.5, 0.9, 2.4, 1]
  ];

  for (const [x, z, scale, rot, shift] of pineLayout) {
    createPine(x, z, scale, rot, shift);
  }

  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + 0.2;
    const radius = rng(21, 29);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    createPine(x, z, rng(1.45, 2.4), rng(0, Math.PI * 2), Math.floor(random() * 4));
  }

  // Broad-leaf trees for silhouette variety
  const leafBlobGeometry = new THREE.IcosahedronGeometry(1, 0);
  const leafMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x4b6a3f, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x607b46, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x7a804a, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xa07d4b, roughness: 1, flatShading: true })
  ];

  function createLeafTree(x, z, scale, autumn) {
    const group = new THREE.Group();
    group.position.set(x, groundHeight(x, z) - 0.02, z);
    group.rotation.y = rng(0, Math.PI * 2);
    group.scale.setScalar(scale);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.28, 2.6, 6), trunkMaterial);
    trunk.position.y = 1.3;
    trunk.castShadow = true;
    group.add(trunk);

    for (let i = 0; i < 5; i++) {
      const blob = new THREE.Mesh(leafBlobGeometry, leafMaterials[autumn ? 3 : i % 3]);
      const angle = (i / 5) * Math.PI * 2;
      blob.position.set(Math.cos(angle) * rng(0.45, 0.9), 2.55 + rng(-0.2, 0.75), Math.sin(angle) * rng(0.45, 0.9));
      blob.scale.set(rng(0.75, 1.15), rng(0.62, 0.92), rng(0.75, 1.15));
      blob.rotation.set(rng(0, 1), rng(0, 3), rng(0, 1));
      blob.castShadow = true;
      blob.receiveShadow = true;
      group.add(blob);
    }

    scene.add(group);
    treeSway.push({ group, phase: rng(0, 6.28), strength: 0.0025 });
    return group;
  }

  createLeafTree(-7.4, 7.5, 0.96, false);
  createLeafTree(11.2, 6.9, 0.88, true);
  createLeafTree(-7.3, -5.4, 1.05, false);
  createLeafTree(11.0, -6.0, 1.0, false);
  createLeafTree(3.2, -7.4, 0.92, true);

  // Grass blades, instanced for performance
  const grassGeometry = new THREE.ConeGeometry(0.055, 0.58, 3);
  grassGeometry.translate(0, 0.29, 0);
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x456346,
    roughness: 1,
    flatShading: true
  });
  const grassCount = isCompact ? 130 : 240;
  const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount);
  const grassMatrix = new THREE.Matrix4();
  const grassQuat = new THREE.Quaternion();
  const grassScale = new THREE.Vector3();
  const grassPosition = new THREE.Vector3();
  let placedGrass = 0;

  while (placedGrass < grassCount) {
    const x = rng(-22, 22);
    const z = rng(-20, 19);
    if (Math.hypot(x, z) < 4.8) continue;
    if (z > 2 && z < 12 && Math.abs(x) < 2.0) continue;
    if (Math.abs(x) < 3.7 && z > -3.5 && z < 4.8) continue;

    grassPosition.set(x, groundHeight(x, z) + 0.02, z);
    grassQuat.setFromEuler(new THREE.Euler(rng(-0.08, 0.08), rng(0, Math.PI * 2), rng(-0.12, 0.12)));
    const s = rng(0.55, 1.25);
    grassScale.set(s, s * rng(0.75, 1.35), s);
    grassMatrix.compose(grassPosition, grassQuat, grassScale);
    grass.setMatrixAt(placedGrass, grassMatrix);
    placedGrass++;
  }
  grass.instanceMatrix.needsUpdate = true;
  grass.castShadow = false;
  grass.receiveShadow = true;
  scene.add(grass);

  // Rocks
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x4b554d,
    roughness: 1,
    flatShading: true
  });
  for (let i = 0; i < 24; i++) {
    let x;
    let z;
    do {
      x = rng(-17, 17);
      z = rng(-15, 15);
    } while (Math.hypot(x, z) < 5.2 || (Math.abs(x) < 3.3 && z > -3 && z < 9));

    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    const s = rng(0.18, 0.55);
    rock.position.set(x, groundHeight(x, z) + s * 0.25, z);
    rock.scale.set(s * rng(0.8, 1.5), s * rng(0.5, 0.9), s * rng(0.8, 1.4));
    rock.rotation.set(rng(0, 1), rng(0, 3), rng(0, 1));
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Mushrooms
  function createMushroom(x, z, scale) {
    const group = new THREE.Group();
    group.position.set(x, groundHeight(x, z), z);
    group.scale.setScalar(scale);

    const stemMat = new THREE.MeshStandardMaterial({ color: 0xd6cbb1, roughness: 1 });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xa74d38,
      roughness: 0.85,
      flatShading: true,
      emissive: 0x2d0b04,
      emissiveIntensity: 0.15
    });

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 0.28, 6), stemMat);
    stem.position.y = 0.14;
    stem.castShadow = true;
    group.add(stem);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      capMat
    );
    cap.position.y = 0.29;
    cap.scale.set(1.05, 0.7, 1.05);
    cap.castShadow = true;
    group.add(cap);

    for (let i = 0; i < 3; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.024, 5, 3),
        new THREE.MeshBasicMaterial({ color: 0xe9d9bd, toneMapped: false })
      );
      const angle = rng(0, Math.PI * 2);
      dot.position.set(Math.cos(angle) * rng(0.02, 0.13), 0.32 + rng(0, 0.04), Math.sin(angle) * rng(0.02, 0.13));
      group.add(dot);
    }
    scene.add(group);
  }

  const mushroomSpots = [
    [-6.9, 3.1, 1.2], [-7.4, 2.7, 0.85], [5.8, 7.1, 1.15], [6.2, 7.6, 0.8],
    [-10.2, 1.6, 1.0], [9.8, -5.2, 0.9], [-3.4, -6.4, 1.0], [7.7, 11.6, 0.85]
  ];
  for (const [x, z, s] of mushroomSpots) {
    createMushroom(x, z, s);
  }

  // Stepping-stone path
  const pathStoneGeo = new THREE.CylinderGeometry(1, 1.08, 0.09, 7);
  const pathStoneMat = new THREE.MeshStandardMaterial({
    color: 0x78796d,
    roughness: 1,
    flatShading: true
  });
  for (let i = 0; i < 14; i++) {
    const z = 4.9 + i * 0.55;
    const x = Math.sin(i * 0.58) * 0.42 + Math.sin(i * 0.19) * 0.3;
    const stone = new THREE.Mesh(pathStoneGeo, pathStoneMat);
    const s = rng(0.27, 0.42);
    stone.position.set(x, groundHeight(x, z) + 0.04, z);
    stone.scale.set(s, 1, s * rng(0.75, 1.05));
    stone.rotation.y = rng(0, Math.PI);
    stone.receiveShadow = true;
    stone.castShadow = true;
    scene.add(stone);
  }

  // A little stone path toward the fire
  for (let i = 0; i < 5; i++) {
    const stone = new THREE.Mesh(pathStoneGeo, pathStoneMat);
    const x = 2.15 + i * 0.56;
    const z = 3.62 - i * 0.09;
    stone.position.set(x, groundHeight(x, z) + 0.04, z);
    const s = rng(0.22, 0.34);
    stone.scale.set(s, 1, s);
    stone.rotation.y = rng(0, Math.PI);
    stone.receiveShadow = true;
    scene.add(stone);
  }

  // Fence beside the path
  const fenceMaterial = new THREE.MeshStandardMaterial({
    color: 0x5d4630,
    roughness: 1,
    flatShading: true
  });
  for (let i = 0; i < 5; i++) {
    const x = -2.75 - i * 0.06;
    const z = 5.4 + i * 0.8;
    addBox(scene, fenceMaterial, 0.1, 0.9, 0.1, x - 0.25, groundHeight(x, z) + 0.45, z);
    if (i < 4) {
      addBox(scene, fenceMaterial, 0.07, 0.07, 0.9, x - 0.25, groundHeight(x, z) + 0.66, z + 0.4, false, true);
      addBox(scene, fenceMaterial, 0.06, 0.06, 0.9, x - 0.25, groundHeight(x, z) + 0.38, z + 0.4, false, true);
    }
  }

  // Mailbox
  const mailbox = new THREE.Group();
  mailbox.position.set(-2.95, groundHeight(-2.95, 8.2), 8.2);
  mailbox.rotation.y = 0.1;
  scene.add(mailbox);
  addBox(mailbox, matLogDark, 0.11, 1.1, 0.11, 0, 0.55, 0);
  addBox(mailbox, matStone, 0.46, 0.3, 0.34, 0, 1.1, 0);
  addBox(mailbox, matStone, 0.46, 0.12, 0.2, 0, 1.28, -0.02);
  addBox(mailbox, new THREE.MeshStandardMaterial({ color: 0x8d3b30, roughness: 0.9 }), 0.05, 0.28, 0.04, 0.23, 1.22, 0.1, false, false);

  /* -----------------------------------------------------------
     Chimney smoke, fireflies and weather particles
     ----------------------------------------------------------- */

  const smokeCount = isCompact ? 34 : 54;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeAges = new Float32Array(smokeCount);
  for (let i = 0; i < smokeCount; i++) {
    smokeAges[i] = random();
    smokePositions[i * 3] = rng(-0.25, 0.25);
    smokePositions[i * 3 + 1] = random() * 4.2;
    smokePositions[i * 3 + 2] = rng(-0.2, 0.2);
  }
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute("position", new THREE.BufferAttribute(smokePositions, 3));
  const smokeMaterial = new THREE.PointsMaterial({
    size: 1.35,
    map: glowTexture,
    color: 0xa9b8b0,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    sizeAttenuation: true,
    fog: true
  });
  const smoke = new THREE.Points(smokeGeometry, smokeMaterial);
  smoke.position.set(-1.85, 5.8, -0.92);
  smoke.frustumCulled = false;
  scene.add(smoke);

  const fireflyCount = isCompact ? 72 : 125;
  const fireflyPositions = new Float32Array(fireflyCount * 3);
  const fireflyBase = new Float32Array(fireflyCount * 3);
  const fireflyPhase = new Float32Array(fireflyCount);
  const fireflySpeed = new Float32Array(fireflyCount);
  const fireflyRadius = new Float32Array(fireflyCount);

  for (let i = 0; i < fireflyCount; i++) {
    const angle = random() * Math.PI * 2;
    const radius = rng(2.7, 13.5);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = groundHeight(x, z) + rng(0.45, 3.3);
    fireflyBase[i * 3] = x;
    fireflyBase[i * 3 + 1] = y;
    fireflyBase[i * 3 + 2] = z;
    fireflyPositions[i * 3] = x;
    fireflyPositions[i * 3 + 1] = y;
    fireflyPositions[i * 3 + 2] = z;
    fireflyPhase[i] = rng(0, Math.PI * 2);
    fireflySpeed[i] = rng(0.16, 0.48);
    fireflyRadius[i] = rng(0.25, 0.9);
  }

  const fireflyGeometry = new THREE.BufferGeometry();
  fireflyGeometry.setAttribute("position", new THREE.BufferAttribute(fireflyPositions, 3));
  const fireflyMaterial = new THREE.PointsMaterial({
    size: 0.18,
    map: glowTexture,
    color: 0xffd67b,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    sizeAttenuation: true
  });
  const fireflies = new THREE.Points(fireflyGeometry, fireflyMaterial);
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  // Rain
  const rainCount = isCompact ? 550 : 1000;
  const rainPositions = new Float32Array(rainCount * 3);
  const rainSpeed = new Float32Array(rainCount);
  for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = rng(-19, 19);
    rainPositions[i * 3 + 1] = rng(0, 18);
    rainPositions[i * 3 + 2] = rng(-18, 19);
    rainSpeed[i] = rng(0.65, 1.3);
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
  const rainMaterial = new THREE.PointsMaterial({
    size: 0.52,
    map: rainTexture,
    color: 0xa5c6d2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true
  });
  const rain = new THREE.Points(rainGeometry, rainMaterial);
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);

  // Snow
  const snowCount = isCompact ? 380 : 700;
  const snowPositions = new Float32Array(snowCount * 3);
  const snowPhase = new Float32Array(snowCount);
  const snowSpeed = new Float32Array(snowCount);
  for (let i = 0; i < snowCount; i++) {
    snowPositions[i * 3] = rng(-20, 20);
    snowPositions[i * 3 + 1] = rng(0, 18);
    snowPositions[i * 3 + 2] = rng(-19, 20);
    snowPhase[i] = rng(0, Math.PI * 2);
    snowSpeed[i] = rng(0.45, 1.0);
  }
  const snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
  const snowMaterial = new THREE.PointsMaterial({
    size: 0.24,
    map: glowTexture,
    color: 0xf4f7ee,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true
  });
  const snow = new THREE.Points(snowGeometry, snowMaterial);
  snow.visible = false;
  snow.frustumCulled = false;
  scene.add(snow);

  /* -----------------------------------------------------------
     Ambient audio (generated, no audio files)
     ----------------------------------------------------------- */

  class Ambience {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.enabled = false;
      this.fire = false;
      this.rain = false;
      this.ready = false;
      this.noiseBuffer = null;
      this.rainGain = null;
      this.chirpTimer = null;
      this.crackleTimer = null;
      this.owlTimer = null;
    }

    async init() {
      if (this.ctx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is not available");

      const ctx = new AudioContextClass();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      this.master = master;

      this.noiseBuffer = this.createNoiseBuffer(ctx, 4);

      // Wind
      const wind = ctx.createBufferSource();
      wind.buffer = this.noiseBuffer;
      wind.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = "lowpass";
      windFilter.frequency.value = 410;
      windFilter.Q.value = 0.55;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.115;
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      wind.start();

      const windLfo = ctx.createOscillator();
      windLfo.frequency.value = 0.068;
      const windLfoGain = ctx.createGain();
      windLfoGain.gain.value = 0.045;
      windLfo.connect(windLfoGain);
      windLfoGain.connect(windGain.gain);
      windLfo.start();

      // Warm, barely-there pad
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = "lowpass";
      padFilter.frequency.value = 760;
      padFilter.Q.value = 0.3;
      const padGain = ctx.createGain();
      padGain.gain.value = 0.021;
      padFilter.connect(padGain);
      padGain.connect(master);

      const padNotes = [130.81, 196.0, 246.94, 329.63];
      padNotes.forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        osc.type = index % 2 === 0 ? "sine" : "triangle";
        osc.frequency.value = frequency;
        osc.detune.value = index * 3 - 4;
        const gain = ctx.createGain();
        gain.gain.value = index === 0 ? 0.38 : 0.18;
        osc.connect(gain);
        gain.connect(padFilter);
        osc.start();
      });

      // Rain layer, silent until enabled
      const rainSource = ctx.createBufferSource();
      rainSource.buffer = this.noiseBuffer;
      rainSource.loop = true;
      const rainHigh = ctx.createBiquadFilter();
      rainHigh.type = "highpass";
      rainHigh.frequency.value = 700;
      const rainLow = ctx.createBiquadFilter();
      rainLow.type = "lowpass";
      rainLow.frequency.value = 5200;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = this.rain ? 0.055 : 0;
      rainSource.connect(rainHigh);
      rainHigh.connect(rainLow);
      rainLow.connect(this.rainGain);
      this.rainGain.connect(master);
      rainSource.start();

      // Sparse crickets
      this.chirpTimer = window.setInterval(() => {
        if (this.enabled) this.chirp();
      }, 3400);

      // Fire crackle
      this.crackleTimer = window.setInterval(() => {
        if (this.enabled && this.fire && Math.random() > 0.25) this.crackle();
      }, 170);

      // Very distant owl once in a while
      this.owlTimer = window.setInterval(() => {
        if (this.enabled && Math.random() > 0.45) this.owl();
      }, 27000);

      this.ready = true;
    }

    createNoiseBuffer(ctx, seconds) {
      const length = Math.floor(ctx.sampleRate * seconds);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.018 * white) / 1.018;
        data[i] = last * 3.1;
      }
      return buffer;
    }

    chirp() {
      if (!this.ctx || !this.enabled) return;
      const ctx = this.ctx;
      const now = ctx.currentTime + 0.02;
      const panner = ctx.createStereoPanner();
      panner.pan.value = rand(-0.85, 0.85);
      panner.connect(this.master);

      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const start = now + i * 0.085;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(rand(3000, 3600), start);
        osc.frequency.exponentialRampToValueAtTime(rand(2400, 2900), start + 0.045);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.018, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
        osc.connect(gain);
        gain.connect(panner);
        osc.start(start);
        osc.stop(start + 0.07);
      }
    }

    crackle() {
      if (!this.ctx || !this.enabled) return;
      const ctx = this.ctx;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.playbackRate.value = rand(0.7, 1.5);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = rand(900, 2400);
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const peak = rand(0.007, 0.032);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + rand(0.035, 0.1));
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(now, rand(0, 2), 0.12);
    }

    owl() {
      if (!this.ctx || !this.enabled) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      for (let i = 0; i < 2; i++) {
        const start = now + i * 0.56;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(rand(370, 410), start);
        osc.frequency.exponentialRampToValueAtTime(rand(300, 330), start + 0.3);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.012, start + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
        const pan = ctx.createStereoPanner();
        pan.pan.value = 0.32;
        osc.connect(gain);
        gain.connect(pan);
        pan.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.42);
      }
    }

    async toggle() {
      if (!this.ctx) await this.init();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.enabled = !this.enabled;
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.enabled ? 0.72 : 0, now, this.enabled ? 0.5 : 0.12);
      return this.enabled;
    }

    setFire(value) {
      this.fire = value;
    }

    setWeather(value) {
      this.rain = value === "rain";
      if (!this.ctx || !this.rainGain) return;
      const now = this.ctx.currentTime;
      this.rainGain.gain.cancelScheduledValues(now);
      this.rainGain.gain.setTargetAtTime(this.rain ? 0.055 : 0, now, 0.9);
    }
  }

  const ambience = new Ambience();

  /* -----------------------------------------------------------
     UI + interactions
     ----------------------------------------------------------- */

  const controls = {};
  $$(".ctrl").forEach((button) => {
    controls[button.dataset.action] = button;
  });

  let toastTimer = 0;
  let whisperTimer = 0;

  function setControlState(action, on, text) {
    const button = controls[action];
    if (!button) return;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    const label = $("[data-state]", button);
    if (label && typeof text === "string") label.textContent = text;
  }

  function showToast(message, duration = 3000) {
    window.clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add("show");
    toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), duration);
  }

  function showWhisper() {
    window.clearTimeout(whisperTimer);
    whisperEl.classList.add("show");
    whisperTimer = window.setTimeout(() => whisperEl.classList.remove("show"), 6200);
  }

  function updateWeatherUI() {
    const labels = {
      clear: { button: "晴 · 微风", status: "微风 · 晴", scene: "萤火出没", toast: "云散开了，月光重新落进院子。" },
      rain: { button: "细雨 · 沙沙", status: "细雨 · 沙沙", scene: "檐下听雨", toast: "细雨落在松针上，屋檐开始滴答作响。" },
      snow: { button: "落雪 · 无声", status: "落雪 · 无声", scene: "松枝覆雪", toast: "下雪了。整座森林都安静下来。" }
    };
    const label = labels[state.weather];
    setControlState("weather", state.weather !== "clear", label.button);
    weatherStatus.textContent = label.status;
    $(".scene-caption span:last-child").textContent = label.scene;
    return label;
  }

  function setLights(on, announce = true) {
    state.lightsOn = on;
    setControlState("lights", on, on ? "暖光已亮" : "只剩余烬");
    if (announce) showToast(on ? "灯芯被轻轻拨亮，木屋暖了起来。" : "灯火熄了，林间的月色更清晰了。");
  }

  function setFire(on, announce = true) {
    state.fireOn = on;
    ambience.setFire(on);
    setControlState("fire", on, on ? "噼啪作响" : "余烬未燃");
    if (on) {
      burstSparks();
      if (announce) showToast("篝火噼啪作响，暖意一点点漫开。");
    } else if (announce) {
      showToast("篝火化成一捧温柔的余烬。");
    }
  }

  function cycleWeather() {
    const order = ["clear", "rain", "snow"];
    const current = order.indexOf(state.weather);
    state.weather = order[(current + 1) % order.length];
    ambience.setWeather(state.weather);
    setControlState("weather", state.weather !== "clear", updateWeatherUI().button);
    showToast(updateWeatherUI().toast, 3600);
  }

  function setDoor(open) {
    state.doorOpen = open;
    setControlState("door", open, open ? "炉火正暖" : "门里亮着灯");
    if (open) {
      state.focus = true;
      orbit.targetAzimuth = 0.08;
      orbit.targetPolar = 1.35;
      orbit.targetRadius = isCompact ? 12.4 : 10.7;
      orbit.targetLookY = 2.0;
      state.lastInteraction = performance.now();
      if (!state.doorSeen) {
        state.doorSeen = true;
        showWhisper();
      } else {
        showToast(state.lightsOn ? "木门吱呀一声开了，暖光漫到脚边。" : "门开了，屋里只有安静的月色。", 3000);
      }
    } else {
      state.focus = false;
      orbit.targetAzimuth = isCompact ? 0.38 : 0.29;
      orbit.targetPolar = 1.35;
      orbit.targetRadius = isCompact ? 17.8 : 14.8;
      orbit.targetLookY = 2.25;
      window.clearTimeout(whisperTimer);
      whisperEl.classList.remove("show");
      showToast("木门轻轻合上，林间又安静下来。", 2600);
    }
  }

  async function toggleSound() {
    try {
      const on = await ambience.toggle();
      state.soundOn = on;
      setControlState("sound", on, on ? "风与虫鸣" : "已静音");
      showToast(on ? "风声、虫鸣和木柴的细响，慢慢围了过来。" : "环境声已收起。", 2800);
    } catch (error) {
      showToast("环境声没能开启，请检查浏览器的音频权限。", 3800);
    }
  }

  function resetView() {
    state.focus = false;
    orbit.targetAzimuth = isCompact ? 0.38 : 0.29;
    orbit.targetPolar = 1.35;
    orbit.targetRadius = isCompact ? 17.8 : 14.8;
    orbit.targetLookY = 2.25;
    state.lastInteraction = performance.now();
    showToast("回到林间的小径上。", 2200);
  }

  function handleAction(action) {
    state.lastInteraction = performance.now();
    if (action === "lights") setLights(!state.lightsOn);
    else if (action === "fire") setFire(!state.fireOn);
    else if (action === "weather") cycleWeather();
    else if (action === "door") setDoor(!state.doorOpen);
    else if (action === "sound") toggleSound();
  }

  for (const [action, button] of Object.entries(controls)) {
    button.addEventListener("click", () => handleAction(action));
  }

  resetBtn.addEventListener("click", resetView);

  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      const request = document.documentElement.requestFullscreen;
      if (request) {
        document.documentElement.requestFullscreen().catch(() => {
          showToast("当前浏览器不允许全屏，请按 F11。", 2600);
        });
      } else {
        showToast("当前浏览器不支持全屏。", 2400);
      }
    } else {
      document.exitFullscreen();
    }
  });

  document.addEventListener("fullscreenchange", () => {
    fullscreenBtn.setAttribute("aria-label", document.fullscreenElement ? "退出全屏" : "全屏漫游");
  });

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "l") handleAction("lights");
    else if (key === "f") handleAction("fire");
    else if (key === "w") handleAction("weather");
    else if (key === "d") handleAction("door");
    else if (key === "m") toggleSound();
    else if (key === "r") resetView();
  });

  // Initial UI sync
  setControlState("lights", true, "暖光已亮");
  setControlState("fire", false, "余烬未燃");
  setControlState("door", false, "门里亮着灯");
  setControlState("sound", false, "风与虫鸣");
  updateWeatherUI();

  /* -----------------------------------------------------------
     Camera controls + raycasting
     ----------------------------------------------------------- */

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const interactiveCopy = interactables;
  const drag = {
    active: false,
    moved: 0,
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    pointerId: null,
    pointerType: "mouse"
  };
  const activePointers = new Map();
  let pinchStartDistance = 0;
  let pinchStartRadius = 0;
  let hoverPending = false;
  let lastPointerEvent = null;

  function setPointerFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickAction(event) {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointerNdc, camera);
    const intersections = raycaster.intersectObjects(interactiveCopy, false);
    if (intersections.length > 0) {
      return intersections[0].object.userData.interact || null;
    }
    return null;
  }

  const pointerLabels = {
    door: "轻叩木门",
    fire: "拨旺篝火",
    lights: "拨动灯火"
  };

  function pointerLabelFor(action) {
    if (action === "door") return state.doorOpen ? "掩上木门" : "轻叩木门";
    if (action === "fire") return state.fireOn ? "熄灭篝火" : "拨旺篝火";
    if (action === "lights") return state.lightsOn ? "熄灭灯火" : "点亮灯火";
    return pointerLabels[action] || "";
  }

  function updateHover(event) {
    if (drag.active || isCompact) {
      setHovered(null);
      return;
    }
    const action = pickAction(event);
    setHovered(action);
    if (action) {
      pointerTip.textContent = pointerLabelFor(action);
      pointerTip.style.left = `${event.clientX}px`;
      pointerTip.style.top = `${event.clientY}px`;
      pointerTip.classList.add("show");
      canvas.classList.add("is-pointing");
    } else {
      pointerTip.classList.remove("show");
      canvas.classList.remove("is-pointing");
    }
  }

  function setHovered(action) {
    state.hovered = action;
  }

  function updateRaycastHover() {
    if (!lastPointerEvent || drag.active || isCompact) return;
    const action = pickAction(lastPointerEvent);
    if (action !== state.hovered) {
      setHovered(action);
      if (action) {
        pointerTip.textContent = pointerLabelFor(action);
        pointerTip.classList.add("show");
        canvas.classList.add("is-pointing");
      } else {
        pointerTip.classList.remove("show");
        canvas.classList.remove("is-pointing");
      }
    }
    if (action) {
      pointerTip.textContent = pointerLabelFor(action);
      pointerTip.style.left = `${lastPointerEvent.clientX}px`;
      pointerTip.style.top = `${lastPointerEvent.clientY}px`;
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    lastPointerEvent = event;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.lastInteraction = performance.now();

    if (activePointers.size === 1) {
      drag.active = true;
      drag.pointerId = event.pointerId;
      drag.pointerType = event.pointerType;
      drag.moved = 0;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
      canvas.classList.remove("is-pointing");
      pointerTip.classList.remove("show");
      if (state.doorOpen) state.focus = true;
    } else if (activePointers.size === 2) {
      const points = Array.from(activePointers.values());
      pinchStartDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      pinchStartRadius = orbit.targetRadius;
      drag.moved = 999;
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    lastPointerEvent = event;
    if (!activePointers.has(event.pointerId)) {
      updateHover(event);
      return;
    }

    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size >= 2) {
      const points = Array.from(activePointers.values());
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (pinchStartDistance > 0) {
        orbit.targetRadius = clamp(pinchStartRadius * (pinchStartDistance / Math.max(distance, 1)), 7.2, 23);
      }
      return;
    }

    if (!drag.active) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);

    orbit.targetAzimuth -= dx * 0.0052;
    orbit.targetPolar = clamp(orbit.targetPolar - dy * 0.0036, 0.92, 1.48);
    state.lastInteraction = performance.now();
  });

  function releasePointer(event) {
    const wasActive = activePointers.has(event.pointerId);
    activePointers.delete(event.pointerId);
    if (!wasActive) return;

    if (activePointers.size === 0) {
      const shouldClick = drag.active && drag.moved < 7 && event.type === "pointerup";
      drag.active = false;
      canvas.classList.remove("is-dragging");
      if (state.doorOpen) state.focus = false;
      if (shouldClick) {
        const action = pickAction(event);
        if (action) handleAction(action);
      }
    } else if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.entries())[0];
      drag.active = true;
      drag.pointerId = remaining[0];
      drag.lastX = remaining[1].x;
      drag.lastY = remaining[1].y;
      drag.moved = 999;
    }
    pinchStartDistance = 0;
    if (event.pointerType === "mouse") {
      updateHover(event);
    }
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("pointerleave", (event) => {
    if (!drag.active && event.pointerType === "mouse") {
      pointerTip.classList.remove("show");
      canvas.classList.remove("is-pointing");
      setHovered(null);
      lastPointerEvent = null;
    }
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      orbit.targetRadius = clamp(orbit.targetRadius + event.deltaY * 0.009, 7.2, 23);
      state.lastInteraction = performance.now();
    },
    { passive: false }
  );

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("selectstart", (event) => event.preventDefault());
  canvas.addEventListener("dragstart", (event) => event.preventDefault());

  document.addEventListener("selectstart", (event) => {
    if (drag.active || activePointers.size > 0) event.preventDefault();
  });

  /* -----------------------------------------------------------
     Weather + fire helpers
     ----------------------------------------------------------- */

  function burstSparks() {
    const sparkData = fire.userData.sparkData;
    const sparkPositions = fire.userData.sparkPositions;
    if (!sparkData) return;
    for (let i = 0; i < sparkData.length; i++) {
      const data = sparkData[i];
      data.life = Math.random() * 1.2;
      data.speed = rand(0.6, 2.2);
      sparkPositions[i * 3] = rng(-0.5, 0.5);
      sparkPositions[i * 3 + 1] = rng(0.2, 1.1);
      sparkPositions[i * 3 + 2] = rng(-0.5, 0.5);
    }
    fire.userData.sparks.geometry.attributes.position.needsUpdate = true;
  }

  /* -----------------------------------------------------------
     Animation loop
     ----------------------------------------------------------- */

  const clock = new THREE.Clock();
  let elapsed = 0;
  let firstRender = true;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;
    const now = performance.now();

    // Gentle automatic orbit after a quiet spell
    if (
      !prefersReducedMotion &&
      !state.focus &&
      !drag.active &&
      !activePointers.size &&
      now - state.lastInteraction > 9000
    ) {
      orbit.targetAzimuth += dt * 0.008;
    }

    orbit.azimuth = damp(orbit.azimuth, orbit.targetAzimuth, 3.2, dt);
    orbit.polar = damp(orbit.polar, orbit.targetPolar, 3.0, dt);
    orbit.radius = damp(orbit.radius, orbit.targetRadius, 2.3, dt);
    orbit.lookY = damp(orbit.lookY, orbit.targetLookY, 2.0, dt);

    const sinPolar = Math.sin(orbit.polar);
    camera.position.x = orbit.radius * sinPolar * Math.sin(orbit.azimuth);
    camera.position.z = orbit.radius * sinPolar * Math.cos(orbit.azimuth);
    camera.position.y = orbit.lookY + orbit.radius * Math.cos(orbit.polar);
    cameraTarget.set(0, orbit.lookY, 0);
    camera.lookAt(cameraTarget);

    // Keep the camera above the terrain
    const terrainAtCamera = groundHeight(camera.position.x, camera.position.z);
    if (camera.position.y < terrainAtCamera + 1.1) {
      camera.position.y = terrainAtCamera + 1.1;
    }

    updateWarmth(dt, elapsed);
    updateDoor(dt);
    updateFire(dt, elapsed);
    updateNature(dt, elapsed);
    updateWeather(dt, elapsed);
    updateSky(dt, elapsed);
    updateShootingStar(dt);

    if (!isCompact && lastPointerEvent && !drag.active) {
      updateRaycastHover();
    }

    renderer.render(scene, camera);

    if (firstRender) {
      firstRender = false;
      revealScene();
    }
  }

  function updateWarmth(dt, time) {
    state.warmth = damp(state.warmth, state.lightsOn ? 1 : 0, 2.8, dt);

    windowGlassMaterial.color.copy(windowOffColor).lerp(warmColor, state.warmth);
    windowGlassMaterial.color.multiplyScalar(1 + Math.sin(time * 2.1) * 0.012);
    lanternMaterial.color.copy(lanternOffColor).lerp(lanternWarmColor, state.warmth);

    for (const glow of windowGlows) {
      glow.material.opacity = glow.userData.baseOpacity * (0.15 + state.warmth * 0.85);
    }

    porchLight.intensity = 1.08 * state.warmth;
    facadeLight.intensity = 1.7 * state.warmth;
    interiorLight.intensity = state.warmth * (state.doorOpen ? 3.0 : 0.4);
    doorSpill.material.opacity = state.doorOpen ? state.warmth * 0.34 : 0;
    porchPool.material.opacity = state.warmth * 0.065;
  }

  function updateDoor(dt) {
    const target = state.doorOpen ? -1.42 : 0;
    doorPivot.rotation.y = damp(doorPivot.rotation.y, target, 3.3, dt);
    if (Math.abs(doorPivot.rotation.y - target) > 0.003) {
      renderer.shadowMap.needsUpdate = true;
    }
  }

  function updateFire(dt, time) {
    state.firePower = damp(state.firePower, state.fireOn ? 1 : 0, 2.4, dt);
    const power = state.firePower;
    const flameGroup = fire.userData.flameGroup;
    const flames = fire.userData.flames;

    flameGroup.visible = power > 0.008;
    flameGroup.scale.setScalar(Math.max(0.001, power));

    if (power > 0.008) {
      for (let i = 0; i < flames.length; i++) {
        const flame = flames[i];
        const seed = flame.userData.seed;
        flame.scale.y = 0.8 + Math.sin(time * (7.5 + i * 1.2) + seed) * 0.16 + Math.sin(time * 3.1 + seed) * 0.06;
        flame.scale.x = 0.9 + Math.sin(time * 5.4 + seed * 2.1) * 0.08;
        flame.scale.z = 0.9 + Math.cos(time * 4.7 + seed * 1.3) * 0.08;
        flame.position.y = flame.userData.baseY + Math.sin(time * 4.8 + seed) * 0.045;
        flame.rotation.y = time * (0.6 + i * 0.22) + seed;
      }
    }

    const flicker = 0.83 + Math.sin(time * 15.7) * 0.06 + Math.sin(time * 8.3 + 1.2) * 0.05;
    fireLight.intensity = power * 7.4 * flicker;
    fireLight.position.y = 1.1 + Math.sin(time * 6.4) * 0.08;
    fireGlow.material.opacity = power * (0.26 + Math.sin(time * 7.4) * 0.04);
    fireGlow.scale.setScalar(5.3 + Math.sin(time * 4.8) * 0.18);
    fire.userData.groundGlow.material.opacity = power * (0.09 + Math.sin(time * 5.6) * 0.018);

    const sparks = fire.userData.sparks;
    sparks.material.opacity = power * 0.9;
    if (power > 0.015) {
      const positions = fire.userData.sparkPositions;
      const data = fire.userData.sparkData;
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        item.life -= dt * (0.36 + item.speed * 0.18);
        if (item.life <= 0) {
          item.life = rng(0.5, 1.3);
          item.speed = rng(0.5, 1.8);
          item.drift = rng(-0.22, 0.22);
          item.phase = rng(0, Math.PI * 2);
          positions[i * 3] = rng(-0.4, 0.4);
          positions[i * 3 + 1] = rng(0.35, 0.9);
          positions[i * 3 + 2] = rng(-0.4, 0.4);
        } else {
          positions[i * 3] += Math.sin(time * 1.8 + item.phase) * 0.05 * dt + item.drift * dt;
          positions[i * 3 + 1] += (0.55 + item.speed) * dt;
          positions[i * 3 + 2] += Math.cos(time * 1.3 + item.phase) * 0.04 * dt;
        }
      }
      sparks.geometry.attributes.position.needsUpdate = true;
    }
  }

  function updateNature(dt, time) {
    // Tree sway
    for (const tree of treeSway) {
      tree.group.rotation.z = Math.sin(time * 0.52 + tree.phase) * tree.strength;
    }

    // Fireflies drift like small lanterns
    const positions = fireflyGeometry.attributes.position.array;
    for (let i = 0; i < fireflyCount; i++) {
      const phase = fireflyPhase[i];
      const speed = fireflySpeed[i];
      const radius = fireflyRadius[i];
      positions[i * 3] = fireflyBase[i * 3] + Math.sin(time * speed + phase) * radius;
      positions[i * 3 + 1] =
        fireflyBase[i * 3 + 1] + Math.sin(time * speed * 1.6 + phase * 1.7) * (radius * 0.55) + Math.sin(time * 0.4 + phase) * 0.12;
      positions[i * 3 + 2] = fireflyBase[i * 3 + 2] + Math.cos(time * speed * 0.8 + phase) * radius;
    }
    fireflyGeometry.attributes.position.needsUpdate = true;
    const fireflyTarget =
      state.weather === "clear" ? 0.9 : state.weather === "rain" ? 0.28 : 0.4;
    fireflyMaterial.opacity = damp(fireflyMaterial.opacity, fireflyTarget, 1.4, dt);
    fireflyMaterial.size = 0.18 + Math.sin(time * 1.6) * 0.012;

    // Chimney smoke drifts up and fades out
    const smokePos = smokeGeometry.attributes.position.array;
    for (let i = 0; i < smokeCount; i++) {
      smokeAges[i] += dt * 0.09;
      if (smokeAges[i] > 1) {
        smokeAges[i] = 0;
        smokePos[i * 3] = rng(-0.25, 0.25);
        smokePos[i * 3 + 1] = 0;
        smokePos[i * 3 + 2] = rng(-0.2, 0.2);
      } else {
        smokePos[i * 3] += Math.sin(time * 0.24 + i * 0.9) * 0.055 * dt;
        smokePos[i * 3 + 1] += (0.23 + (i % 5) * 0.018) * dt;
        smokePos[i * 3 + 2] += Math.cos(time * 0.2 + i * 1.3) * 0.04 * dt;
      }
    }
    smokeGeometry.attributes.position.needsUpdate = true;
    smokeMaterial.opacity = 0.125 + Math.sin(time * 0.4) * 0.015;

    // Mist breathing
    for (const plane of mistPlanes) {
      plane.position.x = plane.userData.baseX + Math.sin(time * 0.045 + plane.userData.phase) * 2.2;
      plane.material.opacity = (state.weather === "rain" ? 0.105 : 0.07) + Math.sin(time * 0.15 + plane.userData.phase) * 0.012;
    }

    // Cat tail language
    if (catTail) {
      catTail.rotation.y = Math.sin(time * 0.65) * 0.16;
      catTail.rotation.z = Math.sin(time * 0.9 + 0.4) * 0.045;
    }
    if (catHead) {
      catHead.rotation.y = Math.sin(time * 0.23) * 0.1;
    }

    // Ambient light reacts to weather
    const weatherDim = state.weather === "rain" ? 0.84 : state.weather === "snow" ? 0.94 : 1;
    hemi.intensity = 1.46 * weatherDim;
    moonlight.intensity = 2.5 * weatherDim;
    ambient.intensity = 0.42 * weatherDim;
    scene.fog.density = damp(scene.fog.density, state.weather === "rain" ? 0.025 : state.weather === "snow" ? 0.021 : 0.0175, 1.2, dt);
  }

  function updateWeather(dt, time) {
    const wantRain = state.weather === "rain";
    const wantSnow = state.weather === "snow";

    rain.visible = wantRain || rainMaterial.opacity > 0.01;
    snow.visible = wantSnow || snowMaterial.opacity > 0.01;

    rainMaterial.opacity = damp(rainMaterial.opacity, wantRain ? 0.62 : 0, 2.2, dt);
    snowMaterial.opacity = damp(snowMaterial.opacity, wantSnow ? 0.86 : 0, 1.8, dt);

    if (rain.visible && rainMaterial.opacity > 0.005) {
      const positions = rainGeometry.attributes.position.array;
      for (let i = 0; i < rainCount; i++) {
        positions[i * 3 + 1] -= (11.5 + rainSpeed[i] * 7) * dt;
        positions[i * 3] -= 2.2 * dt;
        if (positions[i * 3 + 1] < -0.3) {
          positions[i * 3 + 1] = rng(14, 19);
          positions[i * 3] = rng(-19, 19);
          positions[i * 3 + 2] = rng(-18, 19);
        }
        if (positions[i * 3] < -20) positions[i * 3] = 19;
      }
      rainGeometry.attributes.position.needsUpdate = true;
    }

    if (snow.visible && snowMaterial.opacity > 0.005) {
      const positions = snowGeometry.attributes.position.array;
      for (let i = 0; i < snowCount; i++) {
        positions[i * 3 + 1] -= (0.75 + snowSpeed[i]) * dt;
        positions[i * 3] += Math.sin(time * 0.55 + snowPhase[i]) * 0.16 * dt;
        positions[i * 3 + 2] += Math.cos(time * 0.37 + snowPhase[i] * 1.4) * 0.08 * dt;
        if (positions[i * 3 + 1] < 0) {
          positions[i * 3 + 1] = rng(14, 19);
          positions[i * 3] = rng(-20, 20);
          positions[i * 3 + 2] = rng(-19, 20);
        }
      }
      snowGeometry.attributes.position.needsUpdate = true;
    }

    matSnow.opacity = damp(matSnow.opacity, wantSnow ? 0.9 : 0, 1.4, dt);
    if (matSnow.opacity < 0.01) matSnow.visible = false;
    else matSnow.visible = true;
  }

  function updateSky(dt, time) {
    stars.rotation.y += dt * 0.0035;
    starMaterial.opacity = 0.78 + Math.sin(time * 0.62) * 0.08;
    moon.rotation.y += dt * 0.004;
    moonHalo.material.opacity = 0.31 + Math.sin(time * 0.35) * 0.035;
    moonHaloOuter.material.opacity = 0.068 + Math.sin(time * 0.21 + 1.2) * 0.012;
  }

  function updateShootingStar(dt) {
    if (shootingProgress < 0) {
      nextShootingStar -= dt;
      if (nextShootingStar <= 0) {
        shootingProgress = 0;
        shootingStar.visible = true;
        shootingMaterial.opacity = 0;
        shootingStar.position.set(rng(16, 30), rng(24, 34), rng(-48, -36));
      }
      return;
    }

    shootingProgress += dt * 0.72;
    if (shootingProgress >= 1) {
      shootingProgress = -1;
      shootingStar.visible = false;
      nextShootingStar = rng(12, 28);
      return;
    }

    shootingStar.position.x -= dt * 13.5;
    shootingStar.position.y -= dt * 5.5;
    shootingStar.position.z += dt * 1.2;
    shootingMaterial.opacity = Math.sin(shootingProgress * Math.PI) * 0.9;
    shootingMaterial.rotation = -0.42;
  }

  /* -----------------------------------------------------------
     Resize + boot
     ----------------------------------------------------------- */

  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const compact = width <= 760;
    camera.aspect = width / height;
    camera.fov = compact ? 58 : 39;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.55 : 1.9));
    renderer.setSize(width, height, false);
  }

  window.addEventListener("resize", onResize);

  function revealScene() {
    window.setTimeout(() => {
      document.body.classList.add("ready");
      state.ready = true;
      state.lastInteraction = performance.now();
      if (!prefersReducedMotion) {
        window.setTimeout(() => {
          showToast("拖拽环顾四周 · 点击木门或篝火，和森林打个招呼。", 5200);
        }, 1800);
      }
    }, prefersReducedMotion ? 150 : 680);
  }

  function showFatal() {
    if (loading) loading.style.display = "none";
    if (errorCard) {
      errorCard.hidden = false;
      errorCard.style.display = "block";
    }
  }

  window.addEventListener("error", (event) => {
    if (!state.ready && event.error) {
      console.error(event.error);
    }
  });

  // Compile shaders before the reveal, then start the world.
  try {
    renderer.compile(scene, camera);
    animate();
  } catch (error) {
    console.error(error);
    showFatal();
  }
})();
