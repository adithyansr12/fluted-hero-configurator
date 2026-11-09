/*!
 * Fluted Hero v1.1.0 —interactive fluted-glass background (WebGL, no dependencies)
 *
 * Pattern: vertical glass ribs refracting a blue light field (matches the Figma/video design).
 * Interaction: Perlin-noise idle sway + cursor-velocity spring push on every rib,
 *              the same physics model used by isidor.ai's hero "waves".
 *
 * Usage (plain HTML / WordPress / Webflow):
 *   <section class="hero" data-fluted-hero> ...your content... </section>
 *   <script src="fluted-hero.js"></script>           // auto-inits [data-fluted-hero]
 *
 * Usage (JS / React):
 *   const fx = FlutedHero.create(heroEl, { ribWidth: 25 });
 *   fx.set({ cursorGlow: 0 });   // update options live
 *   fx.set({ colors: ['#08041A', '#1E0F5C', '#5B2EE0', '#7A4DFA', '#B49CFD', '#EDE6FF'] });
 *   fx.destroy();                // cleanup (e.g. in a useEffect return)
 *
 * Responsive: options cascade like CSS max-width media queries, measured on the hero's width.
 *   FlutedHero.create(heroEl, {
 *     ribWidth: 25,                                  // desktop / everything
 *     tablet: { refraction: 0.07 },                  // hero ≤ tabletMax (1024px)
 *     mobile: { fit: 'cover', focusX: 0.9 }          // hero ≤ mobileMax (640px), on top of tablet
 *   });
 *
 * Keep your current <video> inside the hero with  data-fluted-fallback  — it is hidden
 * automatically when WebGL starts, and stays visible on devices without WebGL.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    // ---- Look (Figma / video design) ----
    ribWidth: 25,            // css px per glass rib at a 1920px-wide hero (the video's 25px)
    ribScale: true,          // scale ribs with hero width like the video does (false = fixed px)
    ribMin: 10,              // smallest rib width in px when scaling down (phones)
    refraction: 0.085,       // vertical light offset per rib, fraction of hero height ("fins")
    refractionCurve: 1.5,    // fin shape; higher = sharper tips
    ribMagnify: 0.35,        // horizontal magnification inside a rib (lower = flatter, stepped ribs)
    ribSeam: 0.35,           // thin dark seam where two ribs meet
    ribShadow: 0.38,         // light falloff across each rib (left bright → right darker)
    lightSpeed: 1,           // speed of the slow light drift (the motion in the video)
    cursorGlow: 0.22,        // soft light behind the glass that follows the cursor (0 = off)
    // Palette, darkest → brightest: [background, shade, deep, main, highlight, glow core].
    // Any hex values work; pass fewer than six and the last one repeats.
    colors: ['#00061A', '#001E5F', '#055AE1', '#1470FA', '#5AA5FD', '#C8EBFD'],

    // ---- Pattern: how the ribs are laid out ----
    pattern: 'lines',        // 'lines' | 'wave' | 'zigzag' | 'rings' | 'rays' | 'grid'
    patternAngle: 0,         // rotation in degrees (lines, wave, zigzag, grid)
    patternBend: 60,         // wave / zigzag / rings: how far the ribs bend, in px at a 1920px design width
    patternWaves: 2,         // wave / zigzag: repeats per design height; rings: lobes around the circle
    patternCenterX: 0.5,     // rings / rays: center of the pattern (0 = left, 1 = right)
    patternCenterY: 0.5,     // (0 = top, 1 = bottom)
    ribRhythm: [1],          // repeating rib widths as multiples of ribWidth, up to 8, e.g. [1, 1, 3]

    // ---- Framing: how the 16:9 design maps onto the hero ----
    fit: 'stretch',          // 'stretch' = squeeze the whole design into the hero, 'cover' = crop it like object-fit: cover
    zoom: 1,                 // >1 zooms in, <1 shows more of the design around it
    focusX: 0.5,             // which part stays in view when cropped/zoomed (0 = left, 1 = right)
    focusY: 0.5,             // (0 = top, 1 = bottom)

    // ---- Interaction (isidor.ai model) ----
    waveSpeedX: 0.0125,      // idle Perlin sway speed
    waveSpeedY: 0.005,
    waveAmpX: 4,             // idle sway in px (0 = dead-straight ribs like the video; isidor uses 20)
    waveAmpY: 2,
    xGap: 14,                // physics grid spacing (px)
    yGap: 28,
    friction: 0.9,           // spring damping (lower = settles faster)
    tension: 0.01,           // spring pull back to rest
    maxCursorMove: 40,       // max push distance in px
    cursorRadius: 175,       // influence radius in px (grows with cursor speed)
    cursorForce: 1,          // multiplier on push strength
    lightDrag: 0.5,          // how much the light behind the glass is dragged by the push (0–1)

    // ---- Responsive overrides (any option above), by hero width ----
    tabletMax: 1024,
    mobileMax: 640,
    tablet: { fit: 'cover', zoom: 0.8, focusX: 0.85 },   // keeps the diagonal + glow instead of squeezing
    mobile: { fit: 'cover', zoom: 0.75, focusX: 0.92 },

    // ---- Performance ----
    maxDpr: 1.5,
    adaptiveQuality: true,  // lowers internal resolution on slow GPUs
    pauseOffscreen: true
  };

  var PATTERNS = ['lines', 'wave', 'zigzag', 'rings', 'rays', 'grid'];

  /* ------------------------------------------------------------------ */
  /* Perlin noise (2D, improved)                                          */
  /* ------------------------------------------------------------------ */
  function makeNoise(seed) {
    var perm = new Uint8Array(512);
    var p = new Uint8Array(256);
    var s = (seed * 2147483647) | 0 || 1;
    for (var i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      var j = s % (i + 1);
      var t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
    var G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function grad(h, x, y) { var g = G[h & 7]; return g[0] * x + g[1] * y; }
    return function (x, y) {
      var X = Math.floor(x), Y = Math.floor(y);
      x -= X; y -= Y; X &= 255; Y &= 255;
      var u = fade(x), v = fade(y);
      var aa = perm[X + perm[Y]], ab = perm[X + perm[Y + 1]];
      var ba = perm[X + 1 + perm[Y]], bb = perm[X + 1 + perm[Y + 1]];
      var x1 = grad(aa, x, y) + u * (grad(ba, x - 1, y) - grad(aa, x, y));
      var x2 = grad(ab, x, y - 1) + u * (grad(bb, x - 1, y - 1) - grad(ab, x, y - 1));
      return x1 + v * (x2 - x1);
    };
  }

  /* ------------------------------------------------------------------ */
  /* Shaders                                                              */
  /* ------------------------------------------------------------------ */
  var VERT = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';

  var FRAG = [
    'precision highp float;',
    'uniform vec2 uSize;uniform float uDpr;uniform float uTime;',
    'uniform sampler2D uDisp;uniform vec2 uGridOrigin;uniform vec2 uGridGap;uniform vec2 uGridSize;',
    'uniform float uEnc;uniform float uRange;',
    'uniform float uRib;uniform float uRefr;uniform float uCurve;uniform float uMag;',
    'uniform float uHl;uniform float uShadow;uniform float uDrag;',
    'uniform vec3 uMouse;uniform vec4 uFrame;',
    'uniform vec3 uC0;uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uC3;uniform vec3 uC4;uniform vec3 uC5;',
    'uniform float uType;uniform vec2 uDir;uniform vec2 uCenter;uniform float uBend;uniform float uWaves;uniform float uRayN;',
    'uniform float uRhy[8];uniform float uRhyN;uniform float uRhyT;',

    'vec2 disp(vec2 p){',
    '  vec2 uv=((p-uGridOrigin)/uGridGap+0.5)/uGridSize;',
    '  vec4 t=texture2D(uDisp,uv);',
    '  return uEnc>0.5?(vec2(t.r,t.a)*2.0-1.0)*uRange:t.rg;',
    '}',

    'vec3 ramp(float x){',
    '  x=clamp(x,0.0,1.0);',
    '  vec3 c=mix(uC0,uC1,smoothstep(0.0,0.25,x));',
    '  c=mix(c,uC2,smoothstep(0.25,0.5,x));',
    '  c=mix(c,uC3,smoothstep(0.5,0.7,x));',
    '  c=mix(c,uC4,smoothstep(0.7,0.86,x));',
    '  c=mix(c,uC5,smoothstep(0.86,1.0,x));',
    '  return c;',
    '}',

    'float blob(vec2 u,vec2 c,vec2 r){vec2 d=(u-c)/r;return exp(-dot(d,d));}',

    // The light behind the glass: dark navy top-left, diagonal light sheet, bright right edge.
    'float lightField(vec2 s){',
    '  vec2 u=(s-uFrame.xy)/uFrame.zw;float t=uTime;',
    '  float wob=0.012*sin(u.x*3.1+t*0.21)+0.007*sin(u.x*7.3-t*0.17);',
    '  float k=max(u.x-0.6,0.0);',
    '  float yb=0.81-0.45*u.x-2.36*k*k+wob;',
    '  float w=mix(0.10,0.05,smoothstep(0.2,0.7,u.x));',
    '  float edge=smoothstep(yb-0.3*w,yb+0.7*w,u.y);',
    '  float below=max(u.y-yb,0.0);',
    '  float rim=0.18*smoothstep(0.15,0.6,u.x)*(1.0-smoothstep(0.85,1.0,u.x))*exp(-below/0.15);',
    '  vec2 cL=vec2(0.28+0.025*sin(t*0.23),0.86+0.015*cos(t*0.19));',
    '  float gy=0.58+0.02*sin(t*0.15);',
    '  float vx=0.52+0.18*(u.y-0.6)+0.02*sin(t*0.13);',
    '  float valley=exp(-pow((u.x-vx)/0.11,2.0))*smoothstep(0.52,0.75,u.y);',
    // left / middle light: cut by the diagonal edge
    '  float I=0.12+0.06*u.x+rim;',
    '  I+=0.44*blob(u,cL,vec2(0.21,0.32));',
    '  I+=0.12*blob(u,vec2(0.36,0.68),vec2(0.14,0.12));',
    '  I-=0.15*valley;',
    '  I*=edge;',
    // right glow: cut by the edge in the middle, free at the right border
    '  float R=0.66*blob(u,vec2(1.0,gy),vec2(0.42,0.44))+0.40*blob(u,vec2(1.03,gy-0.1),vec2(0.09,0.24))+0.15*smoothstep(0.8,1.0,u.x);',
    '  I+=R*mix(edge,1.0,smoothstep(0.82,0.97,u.x));',
    '  I+=0.30*blob(u,vec2(0.45+0.015*sin(t*0.11),-0.08),vec2(0.10,0.42));',
    '  vec2 m=(s-uMouse.xy)/(0.26*min(uSize.x,uSize.y));',
    '  I+=uMouse.z*exp(-dot(m,m));',
    '  return I;',
    '}',

    // Pattern layout: distance across the ribs at q, in px. 0 lines, 1 wave, 2 zigzag, 3 rings, 4 rays, 5 grid.
    'vec2 patCenter(){return uFrame.xy+uFrame.zw*uCenter;}',
    'float ribV(vec2 q){',
    '  if(uType>2.5&&uType<4.5){',
    '    vec2 e=q-patCenter();float a=atan(e.y,e.x);',
    '    if(uType>3.5)return a/6.2831853*uRayN*uRib;',
    '    return length(e)+uBend*sin(a*uWaves);',
    '  }',
    '  float v=dot(q,uDir);',
    '  if(uType>0.5&&uType<2.5){',
    '    float al=dot(q-uFrame.xy,vec2(-uDir.y,uDir.x))/uFrame.w*uWaves;',
    '    v+=uType<1.5?uBend*sin(al*6.2831853):uBend*(abs(fract(al)-0.5)*4.0-1.0);',
    '  }',
    '  return v;',
    '}',
    // Unit direction across the ribs at q, and how fast ribV changes per px.
    'void ribN(vec2 q,out vec2 n,out float gm){',
    '  if(uType<0.5||uType>4.5){n=uDir;gm=1.0;return;}',
    '  if(uType>3.5){',
    '    vec2 e=q-patCenter();float l=max(length(e),0.001);',
    '    n=vec2(-e.y,e.x)/l;gm=uRayN*uRib/(6.2831853*l);return;',
    '  }',
    '  float v0=ribV(q);',
    '  vec2 g=vec2(ribV(q+vec2(0.5,0.0))-v0,ribV(q+vec2(0.0,0.5))-v0)*2.0;',
    '  gm=max(length(g),0.001);n=g/gm;',
    '}',
    // Position inside the current rib (0..1) and that rib's width, following the width rhythm.
    'float ribCell(float v,out float w){',
    '  w=uRib;',
    '  if(uRhyN<1.5)return fract(v/uRib);',
    '  float m=mod(v/uRib,uRhyT),a=0.0;',
    '  for(int i=0;i<8;i++){',
    '    if(float(i)>=uRhyN)break;',
    '    if(m<a+uRhy[i]){w=uRhy[i]*uRib;return (m-a)/uRhy[i];}',
    '    a+=uRhy[i];',
    '  }',
    '  return 0.0;',
    '}',

    'vec3 shade(vec2 p,out vec4 o,out vec2 n){',
    '  vec2 d=disp(p);',
    '  vec2 q=p-d;',
    '  float gm,w;',
    '  ribN(q,n,gm);',
    '  float f=ribCell(ribV(q),w);',
    '  float g=uType>4.5?fract(dot(q,vec2(-uDir.y,uDir.x))/uRib):0.0;',
    // rays get thinner than a pixel at their center, so the glass fades out there
    '  float fd=(uType>3.5&&uType<4.5)?smoothstep(0.02,0.09,length(q-patCenter())/uFrame.w):1.0;',
    '  o=vec4(f,w,g,gm);',
    '  vec2 s=p-d*uDrag;',
    '  s+=n*(f-0.5)*w*(uMag-1.0)*fd;',
    '  s+=vec2(-n.y,n.x)*uRefr*uFrame.w*pow(1.0-f,uCurve)*fd;',
    '  if(uType>4.5)s+=n*uRefr*uFrame.w*0.6*pow(1.0-g,uCurve);',
    '  float I=lightField(s);',
    '  vec3 c=ramp(I);',
    '  float sh=uShadow*fd*(1.0-0.6*smoothstep(0.7,1.1,I));',
    '  c*=1.0+0.5*sh-sh*smoothstep(0.05,1.0,f);',
    '  c*=1.0-uHl*fd*exp(-pow(f*w/gm/1.4,2.0));',
    '  if(uType>4.5){',
    '    c*=1.0+0.25*sh-0.5*sh*smoothstep(0.05,1.0,g);',
    '    c*=1.0-uHl*exp(-pow(g*uRib/1.4,2.0));',
    '  }',
    '  return c;',
    '}',

    'float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}',

    'void main(){',
    '  vec2 p=vec2(gl_FragCoord.x,uSize.y*uDpr-gl_FragCoord.y)/uDpr;',
    '  vec4 o,o2;vec2 n,n2;',
    '  vec3 col=shade(p,o,n);',
    // antialias only the rib seams: one extra sample on the other side of the seam
    '  float px=1.0/uDpr;',
    '  float dl=o.x*o.y/o.w, dr=(1.0-o.x)*o.y/o.w;',
    '  if(dl<px*0.75){col=mix(shade(p-n*px,o2,n2),col,0.5+0.5*dl/(px*0.75));}',
    '  else if(dr<px*0.75){col=mix(shade(p+n*px,o2,n2),col,0.5+0.5*dr/(px*0.75));}',
    '  if(uType>4.5){',
    '    vec2 t=vec2(-uDir.y,uDir.x);float gl=o.z*uRib,gr=(1.0-o.z)*uRib;',
    '    if(gl<px*0.75){col=mix(shade(p-t*px,o2,n2),col,0.5+0.5*gl/(px*0.75));}',
    '    else if(gr<px*0.75){col=mix(shade(p+t*px,o2,n2),col,0.5+0.5*gr/(px*0.75));}',
    '  }',
    '  col+=(hash(gl_FragCoord.xy+fract(uTime))-0.5)/255.0;',
    '  gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------------ */
  /* Helpers                                                              */
  /* ------------------------------------------------------------------ */
  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }
  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('FlutedHero shader: ' + log);
    }
    return sh;
  }

  /* ------------------------------------------------------------------ */
  /* Instance                                                             */
  /* ------------------------------------------------------------------ */
  function create(container, options) {
    if (!container) throw new Error('FlutedHero.create: container element required');
    var base = assign({}, options || {});
    var bp = 'desktop';
    var W = 0, H = 0, dpr = 1;
    // Effective options for the current hero width: defaults → base → tablet → mobile.
    function computeCfg() {
      var c = assign({}, DEFAULTS);
      for (var k in base) if (k !== 'tablet' && k !== 'mobile') c[k] = base[k];
      var tab = assign({}, DEFAULTS.tablet, base.tablet), mob = assign({}, DEFAULTS.mobile, base.mobile);
      bp = 'desktop';
      if (W && W <= c.tabletMax) { assign(c, tab); bp = 'tablet'; }
      if (W && W <= c.mobileMax) { assign(c, mob); bp = 'mobile'; }
      c.tablet = tab; c.mobile = mob;
      return c;
    }
    function gridKey(c) { return [c.xGap, c.yGap, c.maxCursorMove, c.waveAmpX, c.waveAmpY].join(','); }
    var cfg = computeCfg();
    var reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    var canvas = document.createElement('canvas');
    canvas.className = 'fluted-hero-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0;';
    container.insertBefore(canvas, container.firstChild);

    var gl = null, isGL2 = false, prog = null, buf = null, tex = null, U = {};
    var metrics = { ribPx: 0, frame: [0, 0, 0, 0] };
    var grid = { cols: 0, rows: 0, ox: 0, oy: 0, gx: 1, gy: 1, pts: null, data: null, range: 1 };
    var noise = makeNoise(Math.random());
    var mouse = { x: -9999, y: -9999, lx: -9999, ly: -9999, sx: -9999, sy: -9999, vs: 0, a: 0, set: false, inside: 0, glow: 0 };
    var raf = 0, running = false, visible = true, destroyed = false;
    var t0 = performance.now(), lightClock = 0, lastNow = t0;

    function initGL() {
      var attrs = { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
      gl = canvas.getContext('webgl2', attrs);
      isGL2 = !!gl;
      if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
      if (!gl) return false;

      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('FlutedHero link: ' + gl.getProgramInfoLog(prog));
      gl.useProgram(prog);

      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      ['uSize', 'uDpr', 'uTime', 'uDisp', 'uGridOrigin', 'uGridGap', 'uGridSize', 'uEnc', 'uRange',
        'uRib', 'uRefr', 'uCurve', 'uMag', 'uHl', 'uShadow', 'uDrag', 'uMouse', 'uFrame',
        'uC0', 'uC1', 'uC2', 'uC3', 'uC4', 'uC5',
        'uType', 'uDir', 'uCenter', 'uBend', 'uWaves', 'uRayN', 'uRhy', 'uRhyN', 'uRhyT'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

      tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.uniform1i(U.uDisp, 0);
      applyStaticUniforms();
      return true;
    }

    function applyStaticUniforms() {
      if (!gl) return;
      // framing: a 16:9 "design frame" placed over the hero
      var fw = W || 1, fh = H || 1;
      if (cfg.fit === 'cover' && W && H) {
        if (W / H > 16 / 9) { fw = W; fh = W * 9 / 16; } else { fh = H; fw = H * 16 / 9; }
      }
      var z = cfg.zoom > 0 ? cfg.zoom : 1;
      fw *= z; fh *= z;
      metrics.frame = [(W - fw) * cfg.focusX, (H - fh) * cfg.focusY, fw, fh];
      metrics.ribPx = cfg.ribScale && W ? Math.max(cfg.ribMin, cfg.ribWidth * fw / 1920) : cfg.ribWidth;
      gl.uniform4f(U.uFrame, metrics.frame[0], metrics.frame[1], fw, fh);
      gl.uniform1f(U.uRib, metrics.ribPx);
      gl.uniform1f(U.uRefr, cfg.refraction);
      gl.uniform1f(U.uCurve, cfg.refractionCurve);
      gl.uniform1f(U.uMag, cfg.ribMagnify);
      gl.uniform1f(U.uHl, cfg.ribSeam);
      gl.uniform1f(U.uShadow, cfg.ribShadow);
      gl.uniform1f(U.uDrag, cfg.lightDrag);
      var c = cfg.colors;
      for (var i = 0; i < 6; i++) gl.uniform3fv(U['uC' + i], hexToRgb(c[Math.min(i, c.length - 1)]));

      // pattern
      var type = Math.max(0, PATTERNS.indexOf(cfg.pattern));
      var rad = (+cfg.patternAngle || 0) * Math.PI / 180;
      var rhythm = (Array.isArray(cfg.ribRhythm) ? cfg.ribRhythm : []).map(Number)
        .filter(function (v) { return isFinite(v) && v > 0; }).slice(0, 8);
      if (!rhythm.length) rhythm = [1];
      var total = 0, slots = new Float32Array(8);
      rhythm.forEach(function (v, n) { slots[n] = v; total += v; });
      var waves = Math.max(0.1, +cfg.patternWaves || 1);
      if (type === 3) waves = Math.max(1, Math.round(waves));   // rings: a whole number of lobes, so no seam
      var bend = (+cfg.patternBend || 0) * (cfg.ribScale && W ? fw / 1920 : 1);
      // rays: a whole number of rhythm repeats around the circle, so no seam
      var rayRepeats = Math.max(3, Math.round(2 * Math.PI * 0.25 * fw / (metrics.ribPx * total)));
      gl.uniform1f(U.uType, type);
      gl.uniform2f(U.uDir, Math.cos(rad), Math.sin(rad));
      gl.uniform2f(U.uCenter, cfg.patternCenterX, cfg.patternCenterY);
      gl.uniform1f(U.uBend, bend);
      gl.uniform1f(U.uWaves, waves);
      gl.uniform1f(U.uRayN, rayRepeats * total);
      gl.uniform1fv(U.uRhy, slots);
      gl.uniform1f(U.uRhyN, rhythm.length);
      gl.uniform1f(U.uRhyT, total);
    }

    function buildGrid() {
      var pad = cfg.maxCursorMove + Math.max(cfg.waveAmpX, cfg.waveAmpY) + 20;
      var gx = cfg.xGap, gy = cfg.yGap;
      var cols = Math.ceil((W + pad * 2) / gx) + 1;
      var rows = Math.ceil((H + pad * 2) / gy) + 1;
      if (cols > 200) { gx *= cols / 200; cols = Math.ceil((W + pad * 2) / gx) + 1; }
      if (rows > 90) { gy *= rows / 90; rows = Math.ceil((H + pad * 2) / gy) + 1; }
      grid.cols = cols; grid.rows = rows; grid.gx = gx; grid.gy = gy;
      grid.ox = -pad; grid.oy = -pad;
      // per point: cx, cy, vx, vy, wx, wy
      grid.pts = new Float32Array(cols * rows * 6);
      grid.range = cfg.maxCursorMove + Math.max(cfg.waveAmpX, cfg.waveAmpY) + 1;
      grid.data = isGL2 ? new Float32Array(cols * rows * 2) : new Uint8Array(cols * rows * 2);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (isGL2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, cols, rows, 0, gl.RG, gl.FLOAT, grid.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, cols, rows, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, grid.data);
      gl.uniform2f(U.uGridOrigin, grid.ox, grid.oy);
      gl.uniform2f(U.uGridGap, gx, gy);
      gl.uniform2f(U.uGridSize, cols, rows);
      gl.uniform1f(U.uEnc, isGL2 ? 0 : 1);
      gl.uniform1f(U.uRange, grid.range);
    }

    // Layout size (clientWidth/Height ignore CSS transforms, so scaled previews work too).
    function resize() {
      if (!gl) return;
      var nw = Math.max(1, Math.round(container.clientWidth)), nh = Math.max(1, Math.round(container.clientHeight));
      var sizeChanged = nw !== W || nh !== H || !grid.pts;
      var prevKey = gridKey(cfg);
      W = nw; H = nh;
      cfg = computeCfg();
      var nd = Math.min(global.devicePixelRatio || 1, cfg.maxDpr) * quality;
      if (sizeChanged || nd !== dpr) {
        dpr = nd;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(U.uSize, W, H);
        gl.uniform1f(U.uDpr, canvas.width / W);
      }
      applyStaticUniforms();
      if (sizeChanged || gridKey(cfg) !== prevKey) buildGrid();
      if (!running) render(performance.now(), true);
    }

    // isidor-style physics: idle Perlin sway + cursor-velocity spring push
    function step(now) {
      mouse.sx += (mouse.x - mouse.sx) * 0.1;
      mouse.sy += (mouse.y - mouse.sy) * 0.1;
      var dx = mouse.x - mouse.lx, dy = mouse.y - mouse.ly;
      var d = Math.hypot(dx, dy);
      mouse.vs += (d - mouse.vs) * 0.1;
      mouse.vs = Math.min(100, mouse.vs);
      mouse.lx = mouse.x; mouse.ly = mouse.y;
      mouse.a = Math.atan2(dy, dx);
      mouse.glow += (mouse.inside - mouse.glow) * 0.05;

      var P = grid.pts, D = grid.data, cols = grid.cols, rows = grid.rows;
      var wsx = now * cfg.waveSpeedX, wsy = now * cfg.waveSpeedY;
      var l = Math.max(cfg.cursorRadius, mouse.vs);
      var push = mouse.vs * 0.00065 * cfg.cursorForce;
      var ca = Math.cos(mouse.a), sa = Math.sin(mouse.a);
      var ten = cfg.tension, fr = cfg.friction, mm = cfg.maxCursorMove;
      var ax = cfg.waveAmpX, ay = cfg.waveAmpY, range = grid.range;
      var doWave = ax !== 0 || ay !== 0;

      for (var j = 0; j < rows; j++) {
        var y = grid.oy + j * grid.gy;
        for (var i = 0; i < cols; i++) {
          var x = grid.ox + i * grid.gx;
          var k = (j * cols + i) * 6;
          if (doWave) {
            var n = noise((x + wsx) * 0.002, (y + wsy) * 0.0015) * 12;
            P[k + 4] = Math.cos(n) * ax;
            P[k + 5] = Math.sin(n) * ay;
          }
          var ddx = x - mouse.sx, ddy = y - mouse.sy;
          var dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist < l && push > 0) {
            var f = Math.cos(dist * 0.001) * (1 - dist / l) * l * push;
            P[k + 2] += ca * f;
            P[k + 3] += sa * f;
          }
          P[k + 2] = (P[k + 2] - P[k] * ten) * fr;
          P[k + 3] = (P[k + 3] - P[k + 1] * ten) * fr;
          var cx = P[k] + P[k + 2] * 2, cy = P[k + 1] + P[k + 3] * 2;
          P[k] = cx > mm ? mm : cx < -mm ? -mm : cx;
          P[k + 1] = cy > mm ? mm : cy < -mm ? -mm : cy;

          var o = (j * cols + i) * 2;
          var vx = P[k] + P[k + 4], vy = P[k + 1] + P[k + 5];
          if (isGL2) { D[o] = vx; D[o + 1] = vy; }
          else {
            D[o] = Math.max(0, Math.min(255, Math.round((vx / range * 0.5 + 0.5) * 255)));
            D[o + 1] = Math.max(0, Math.min(255, Math.round((vy / range * 0.5 + 0.5) * 255)));
          }
        }
      }
    }

    function upload() {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (isGL2) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid.cols, grid.rows, gl.RG, gl.FLOAT, grid.data);
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid.cols, grid.rows, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, grid.data);
    }

    // Physics runs at a fixed 60 Hz so the feel is identical on 60/120/144 Hz screens.
    var STEP = 1 / 60, acc = 0;
    function render(now, force) {
      if (!gl || destroyed) return;
      var dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      if (!reduceMotion) lightClock += dt * cfg.lightSpeed;
      var simT = reduceMotion ? 0 : now - t0, steps = 0;
      acc += dt;
      while (acc >= STEP && steps < 4) { step(simT); acc -= STEP; steps++; }
      if (acc >= STEP) acc = 0;
      if (force && !steps) { step(simT); steps = 1; }
      if (steps) upload();
      gl.uniform1f(U.uTime, lightClock);
      gl.uniform3f(U.uMouse, mouse.sx, mouse.sy, cfg.cursorGlow * mouse.glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Adaptive quality: if frames stay slow, render fewer pixels (never goes back up).
    var quality = 1, slowFrames = 0, lastFrame = 0, ema = 16;
    function loop(now) {
      if (!running) return;
      render(now);
      if (cfg.adaptiveQuality && lastFrame) {
        var ft = now - lastFrame;
        if (ft < 250) {
          ema += (ft - ema) * 0.05;
          slowFrames++;
          if (slowFrames > 90 && ema > 26 && quality > 0.5) {
            quality = Math.max(0.5, quality * 0.8);
            slowFrames = 0; ema = 16;
            resize();
          }
        }
      }
      lastFrame = now;
      raf = requestAnimationFrame(loop);
    }
    function start() {
      if (running || destroyed || reduceMotion || !visible || document.hidden || !gl) return;
      running = true;
      lastNow = performance.now();
      lastFrame = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }

    // pointer
    function updateMouse(cx, cy) {
      var r = container.getBoundingClientRect();
      var kx = r.width ? W / r.width : 1, ky = r.height ? H / r.height : 1;
      mouse.x = (cx - r.left) * kx; mouse.y = (cy - r.top) * ky;
      mouse.inside = (cx >= r.left && cy >= r.top && cx <= r.right && cy <= r.bottom) ? 1 : 0;
      if (!mouse.set) {
        mouse.sx = mouse.lx = mouse.x;
        mouse.sy = mouse.ly = mouse.y;
        mouse.set = true;
      }
    }
    function onPointer(e) { updateMouse(e.clientX, e.clientY); }
    function onTouch(e) { if (e.touches && e.touches[0]) updateMouse(e.touches[0].clientX, e.touches[0].clientY); }
    function onLeave() { mouse.inside = 0; }
    function onVis() { if (document.hidden) stop(); else start(); }
    function onLost(e) { e.preventDefault(); stop(); gl = null; }
    function onRestored() { if (initGL()) { grid.pts = null; resize(); start(); } }

    // ---- boot ----
    try {
      if (!initGL()) { canvas.remove(); return null; }
    } catch (err) {
      console.warn(err); canvas.remove(); return null;
    }
    var fallback = container.querySelectorAll('[data-fluted-fallback]');
    for (var fi = 0; fi < fallback.length; fi++) {
      fallback[fi].style.display = 'none';
      if (fallback[fi].pause) try { fallback[fi].pause(); } catch (e) { /* noop */ }
    }

    resize();
    var ro = global.ResizeObserver ? new ResizeObserver(function () { resize(); }) : null;
    if (ro) ro.observe(container); else global.addEventListener('resize', resize);

    global.addEventListener('pointermove', onPointer, { passive: true });
    global.addEventListener('touchmove', onTouch, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);

    var io = null;
    if (cfg.pauseOffscreen && global.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start(); else stop();
      }, { rootMargin: '50px' });
      io.observe(container);
    }
    start();

    return {
      canvas: canvas,
      // Merge options. Inside tablet/mobile a null value removes that override; tablet: null clears them all.
      set: function (opts) {
        opts = opts || {};
        for (var k in opts) {
          var v = opts[k];
          if (k === 'tablet' || k === 'mobile') {
            if (v === null) { base[k] = {}; continue; }
            var o = assign({}, base[k]);
            for (var kk in v) { if (v[kk] === null) delete o[kk]; else o[kk] = v[kk]; }
            base[k] = o;
          } else if (v === null) delete base[k];
          else base[k] = v;
        }
        resize();
      },
      refresh: function () { resize(); },
      get options() { return assign({}, cfg); },       // effective options at the current size
      get breakpoint() { return bp; },                  // 'desktop' | 'tablet' | 'mobile'
      get metrics() { return { width: W, height: H, ribPx: metrics.ribPx, frame: metrics.frame.slice() }; },
      destroy: function () {
        destroyed = true; stop();
        if (ro) ro.disconnect(); else global.removeEventListener('resize', resize);
        if (io) io.disconnect();
        global.removeEventListener('pointermove', onPointer);
        global.removeEventListener('touchmove', onTouch);
        document.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('visibilitychange', onVis);
        var ext = gl && gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        canvas.remove();
        for (var i = 0; i < fallback.length; i++) fallback[i].style.display = '';
      }
    };
  }

  function autoInit() {
    var els = document.querySelectorAll('[data-fluted-hero]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].__flutedHero) continue;
      var opts = {};
      var raw = els[i].getAttribute('data-fluted-hero');
      if (raw) try { opts = JSON.parse(raw); } catch (e) { console.warn('FlutedHero: invalid JSON in data-fluted-hero'); }
      els[i].__flutedHero = create(els[i], opts);
    }
  }

  var api = { version: '1.1.0', create: create, defaults: DEFAULTS, patterns: PATTERNS.slice() };
  global.FlutedHero = api;
  if (typeof module === 'object' && module.exports) module.exports = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit);
    else autoInit();
  }
})(typeof window !== 'undefined' ? window : this);
