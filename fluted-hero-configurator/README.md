# Fluted Glass Hero Configurator

A public page where anyone can tune the interactive fluted-glass hero background (colors, framing, glass, cursor physics, with separate Desktop / Tablet / Mobile settings) and copy ready-to-paste code for their own site.

## What's in this folder

| File | What it is |
| --- | --- |
| `index.html` | The configurator page |
| `fluted-hero.js` | The effect script, readable source (v1.2.0) |
| `fluted-hero.min.js` | The same script, minified (25 KB, about 10 KB gzipped) |
| `pattern-analyzer.js` | Reads an uploaded image for the configurator; your own site does not need it |
| `README.md` | This guide |

The page loads `fluted-hero.js` from the same folder, and its download buttons point at both script files, so keep all of them together.

## Deploy it

It is a static site: no build step, no server code, no database. Upload the folder anywhere that serves files over **HTTPS** (the copy and share buttons need HTTPS; on plain HTTP browsers block clipboard access).

**Hostinger / cPanel**
1. Open File Manager and go to `public_html`.
2. Create a folder, for example `fluted-hero`.
3. Upload the five files into it.
4. Open `https://your-domain.com/fluted-hero/`.

**Netlify**: drag the folder onto https://app.netlify.com/drop.

**Vercel**: run `npx vercel` inside the folder, or import it from a Git repo.

**GitHub Pages**: push the files to a repo and turn on Pages for that branch.

Opening `index.html` straight from your disk (`file://`) shows the effect, but the share and download buttons need the page to be served from a web address.

## Using the configurator

- **Desktop / Tablet / Mobile** at the top of the settings panel picks which screen you are editing. Tablet settings override Desktop; Mobile settings override both. A dot marks every setting changed for that screen.
- **Breakpoints** default to a hero up to 1024 px wide for Tablet and up to 640 px for Mobile, and can be changed in the panel.
- **Match an image** reads a picture in your browser and sets the rib layout, spacing, colors and light to resemble it. Remove image and undo restores your earlier settings. Images are center-cropped to 16:9.
- **Pattern** picks the rib layout, shapes it with sliders, and sets a repeating rib-width rhythm. **Save this pattern** keeps it in your browser for later; share links and the generated code include the current pattern.
- **Colors** apply to every screen.
- **Share link** copies a URL with the settings inside it (after `#s=`). Whoever opens it sees the same settings. Nothing is stored on the server.
- **Copy settings** copies the settings as JSON. The code samples under "Add it to your site" already include them and update as you tune.

## Adding the effect to a website

Plain HTML, WordPress or Webflow:

```html
<section class="hero" data-fluted-hero='{"mobile":{"zoom":0.6}}'>
  <video data-fluted-fallback autoplay muted loop playsinline src="/media/hero.mp4"></video>
  <div class="hero-content">…</div>
</section>

<style>
  .hero { position: relative; overflow: hidden; min-height: 90vh; }
  .hero-content { position: relative; z-index: 1; }
</style>
<script src="/js/fluted-hero.min.js" defer></script>
```

- Any element with `data-fluted-hero` starts automatically. The attribute holds the settings JSON, or can be left empty for the defaults.
- `data-fluted-fallback` on an existing video or image hides it once WebGL starts; devices without WebGL keep seeing it.

From JavaScript:

```js
const fx = FlutedHero.create(document.querySelector('.hero'), { /* settings */ });
fx.set({ colors: ['#08041A', '#1E0F5C', '#5B2EE0', '#7A4DFA', '#B49CFD', '#EDE6FF'] });
fx.set({ mobile: { zoom: null } });   // null removes a single tablet/mobile override
fx.breakpoint;                         // 'desktop' | 'tablet' | 'mobile'
fx.destroy();
```

For React, Next.js or Vite, copy the component from the configurator page. It loads `/fluted-hero.js` from your `public` folder on the client and cleans up on unmount.

## Main settings

| Setting | Default | What it does |
| --- | --- | --- |
| `colors` | blue palette | Six hex colors, darkest to brightest: background, shade, deep, main, highlight, glow core |
| `pattern` | `'lines'` | Rib layout: `'lines'`, `'wave'`, `'zigzag'`, `'rings'`, `'rays'` or `'grid'` |
| `patternAngle` | `0` | Rotation in degrees (lines, wave, zigzag, grid) |
| `patternBend`, `patternWaves` | `60`, `2` | How far ribs bend (px at a 1920 px design width) and how many repeats (wave, zigzag, rings) |
| `patternCenterX`, `patternCenterY` | `0.5`, `0.5` | Center of rings or rays (0 = left/top, 1 = right/bottom) |
| `ribRhythm` | `[1]` | Repeating rib widths as multiples of `ribWidth`, up to 8 values from 0.25 to 6, e.g. `[1, 1, 3]` |
| `lightMap` | `''` | Light behind the glass as `"WxH:base64"` brightness bytes; empty uses the built-in diagonal light. Match an image fills this in |
| `fit` | `'stretch'` | `'stretch'` squeezes the whole 16:9 design into the hero; `'cover'` crops it to fill |
| `zoom`, `focusX`, `focusY` | `1`, `0.5`, `0.5` | Zoom and which part stays in view (0 = left/top, 1 = right/bottom) |
| `ribWidth`, `ribMin` | `25`, `10` | Rib width in px at a 1920 px design width, and the smallest it may get |
| `refraction` | `0.085` | Height of the light "fins", as a fraction of the design height |
| `ribShadow` | `0.38` | Light falloff across each rib |
| `cursorGlow` | `0.22` | Soft light that follows the cursor (0 turns it off) |
| `waveAmpX` / `waveAmpY` | `4` / `2` | Idle sway in px (0 = straight ribs) |
| `maxCursorMove`, `cursorForce`, `cursorRadius` | `40`, `1`, `175` | How far, how hard and how wide the cursor pushes the ribs |
| `tension`, `friction` | `0.01`, `0.9` | Spring feel: pull back to rest, and damping |
| `tabletMax`, `mobileMax` | `1024`, `640` | Hero widths where Tablet and Mobile settings start |
| `tablet`, `mobile` | crop-to-fill framing | Overrides for those screens (any setting above) |

## Browser support

Any browser with WebGL (every current desktop and mobile browser). It uses WebGL 2 when available and falls back to WebGL 1. Visitors who ask for reduced motion get a still frame.
