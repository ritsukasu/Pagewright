'use strict';
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  if (attrs)
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const LANG_ORDER = Object.keys(LANGS);
let curLang = 'en';
const fmtSize = (n) =>
  n < 1024
    ? n + ' B'
    : n < 1048576
      ? (n / 1024).toFixed(1) + ' KB'
      : (n / 1048576).toFixed(2) + ' MB';
const baseName = (n) => String(n || 'document').replace(/\.[^.]+$/, '');
let toastT;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}
const { PDFDocument, StandardFonts, rgb, degrees, PDFHexString, LineCapStyle, LineJoinStyle } =
  PDFLib;
if (window.pdfjsLib)
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
const LIBS = {
  jszip: CDN + 'jszip/3.10.1/jszip.min.js',
  mammoth: CDN + 'mammoth/1.6.0/mammoth.browser.min.js',
  xlsx: CDN + 'xlsx/0.18.5/xlsx.full.min.js',
  html2canvas: CDN + 'html2canvas/1.4.1/html2canvas.min.js',
  pptx: CDN + 'pptxgenjs/3.12.0/pptxgen.bundle.js',
  fontkit: 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
};
const libP = {};
function lib(k) {
  return (
    libP[k] ||
    (libP[k] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIBS[k];
      s.onload = () => res();
      s.onerror = () => {
        delete libP[k];
        rej(new Error('Could not load the ' + k + ' library. Check your connection.'));
      };
      document.head.appendChild(s);
    }))
  );
}

function parseRanges(str, n) {
  const out = new Set();
  for (const part of String(str || '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m && (m[1] || m[2])) {
      const a = m[1] ? +m[1] : 1,
        b = m[2] ? +m[2] : n;
      for (let i = Math.max(1, a); i <= Math.min(n, b); i++) out.add(i - 1);
    } else if (/^\d+$/.test(t)) {
      const i = +t;
      if (i >= 1 && i <= n) out.add(i - 1);
    } else throw new Error('Cannot read the page range "' + t + '". Use values like 1-3, 5, 8-.');
  }
  return [...out].sort((a, b) => a - b);
}
const WIN = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const MAPC = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '•',
  ' ': ' ',
  '→': '->',
  '←': '<-',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '\t': '    ',
};
function sanitize(s) {
  let o = '';
  for (const ch of String(s)) {
    if (MAPC[ch] !== undefined && !WIN.includes(ch)) {
      o += MAPC[ch];
      continue;
    }
    const c = ch.codePointAt(0);
    if (c === 10) o += '\n';
    else if (c < 32 || c === 127 || (c >= 128 && c < 160 && !WIN.includes(ch))) continue;
    else if (c <= 255 || WIN.includes(ch)) o += ch;
    else o += MAPC[ch] ?? '?';
  }
  return o;
}
const hex2rgb = (c) => {
  const n = parseInt((c || '#000000').slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const fileFromBytes = (b, name, type = 'application/pdf') => new File([b], name, { type });
async function pdfLoad(f) {
  return PDFDocument.load(await f.arrayBuffer(), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
}
function canvasBlob(c, type = 'image/jpeg', q = 0.85) {
  return new Promise((r) => c.toBlob(r, type, q));
}
async function renderPdfPage(pj, i, scale, rotation) {
  const page = await pj.getPage(i + 1);
  const vp = page.getViewport({ scale, rotation: rotation ?? page.rotate });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}
const openPj = async (bytes) => pdfjsLib.getDocument({ data: bytes.slice() }).promise;
const U8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

async function offer(name, data) {
  let d = null;
  try {
    d = await window.claude?.use?.('downloads');
  } catch {}
  if (!d) {
    try {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Saved ' + name);
      return true;
    } catch (e) {
      toast('Could not save: ' + ((e && e.message) || 'unknown error'), 5000);
      return false;
    }
  }
  try {
    const r = await d.save({
      filename: name,
      data:
        data instanceof Blob || ArrayBuffer.isView(data) || typeof data === 'string'
          ? data
          : new Blob([data]),
    });
    toast(r.status === 'saved' ? 'Saved ' + name : 'Sent ' + name);
    return true;
  } catch (e) {
    if (e && e.code === 'declined') toast('Save cancelled.');
    else toast('Could not save: ' + ((e && e.message) || 'unknown error'), 5000);
    return false;
  }
}
function geo(page) {
  const cb = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return { r, x0: cb.x, y0: cb.y, W: cb.width, H: cb.height };
}
const vsize = (g) => (g.r % 180 ? [g.H, g.W] : [g.W, g.H]);
function U(g, vx, vy) {
  switch (g.r) {
    case 0:
      return [g.x0 + vx, g.y0 + g.H - vy];
    case 90:
      return [g.x0 + vy, g.y0 + vx];
    case 180:
      return [g.x0 + g.W - vx, g.y0 + vy];
    default:
      return [g.x0 + g.W - vy, g.y0 + g.H - vx];
  }
}
const pathD = (g, pts, close) =>
  pts
    .map((p, i) => {
      const [ux, uy] = U(g, p[0], p[1]);
      return (i ? 'L' : 'M') + ux.toFixed(2) + ' ' + (-uy).toFixed(2);
    })
    .join(' ') + (close ? ' Z' : '');
function drawPath(page, g, pts, o) {
  const opt = { x: 0, y: 0 };
  if (o.fill) opt.color = hex2rgb(o.fill);
  if (o.stroke) {
    opt.borderColor = hex2rgb(o.stroke);
    opt.borderWidth = o.sw || 1;
    opt.borderLineCap = LineCapStyle.Round;
  }
  if (o.op != null) {
    opt.opacity = o.op;
    opt.borderOpacity = o.op;
  }
  if (!o.fill && !o.stroke) return;
  page.drawSvgPath(pathD(g, pts, o.close), opt);
}
const boxPts = (b) => [
  [b.x, b.y],
  [b.x + b.w, b.y],
  [b.x + b.w, b.y + b.h],
  [b.x, b.y + b.h],
];
const ellPts = (b) => {
  const o = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    o.push([b.x + b.w / 2 + (Math.cos(a) * b.w) / 2, b.y + b.h / 2 + (Math.sin(a) * b.h) / 2]);
  }
  return o;
};
function wrapText(font, size, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (!line || font.widthOfTextAtSize(t, size) <= maxW) line = t;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}
const STD_FONTS = {
  Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};
const CSSFONT = {
  Helvetica: 'Helvetica,Arial,"Geist",sans-serif',
  Times: '"Times New Roman",Times,serif',
  Courier: '"Courier New",Courier,monospace',
};

const FONT_CDN = 'https://cdn.jsdelivr.net/npm/@fontsource/';
const wf = (name, pkg, kind, like, flags = 'bi', ver = '5.3.0') => ({
  name,
  pkg,
  kind,
  like,
  bold: flags.includes('b'),
  italic: flags.includes('i'),
  ver,
});
const WEBFONTS = [
  wf('Calibri', 'carlito', 'sans', 'Carlito'),
  wf('Cambria', 'caladea', 'serif', 'Caladea'),
  wf('Arial', 'arimo', 'sans', 'Arimo'),
  wf('Times New Roman', 'tinos', 'serif', 'Tinos'),
  wf('Courier New', 'cousine', 'mono', 'Cousine'),
  wf('Georgia', 'gelasio', 'serif', 'Gelasio'),
  wf('Garamond', 'eb-garamond', 'serif', 'EB Garamond'),
  wf('Comic Sans MS', 'comic-neue', 'sans', 'Comic Neue'),
  wf('Impact', 'anton', 'sans', 'Anton', ''),
  wf('Consolas', 'inconsolata', 'mono', 'Inconsolata', 'b'),
  wf('Roboto', 'roboto', 'sans'),
  wf('Open Sans', 'open-sans', 'sans'),
  wf('Lato', 'lato', 'sans'),
  wf('Montserrat', 'montserrat', 'sans'),
  wf('Poppins', 'poppins', 'sans'),
  wf('Inter', 'inter', 'sans'),
  wf('Raleway', 'raleway', 'sans'),
  wf('Nunito', 'nunito', 'sans'),
  wf('Source Sans 3', 'source-sans-3', 'sans', '', 'bi', '5.3.1'),
  wf('PT Sans', 'pt-sans', 'sans'),
  wf('Oswald', 'oswald', 'sans', '', 'b'),
  wf('Playfair Display', 'playfair-display', 'serif'),
  wf('Merriweather', 'merriweather', 'serif'),
  wf('Lora', 'lora', 'serif'),
  wf('PT Serif', 'pt-serif', 'serif'),
  wf('Roboto Mono', 'roboto-mono', 'mono'),
  wf('Source Code Pro', 'source-code-pro', 'mono', '', 'bi', '5.3.1'),
  wf('Dancing Script', 'dancing-script', 'script', '', 'b'),
  wf('Caveat', 'caveat', 'script', '', 'b'),
  wf('Abel', 'abel', 'sans', '', '', '5.3.0'),
  wf('Albert Sans', 'albert-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Archivo', 'archivo', 'sans', '', 'bi', '5.3.0'),
  wf('Asap', 'asap', 'sans', '', 'bi', '5.3.0'),
  wf('Assistant', 'assistant', 'sans', '', 'b', '5.3.0'),
  wf('Barlow', 'barlow', 'sans', '', 'bi', '5.3.0'),
  wf('Be Vietnam Pro', 'be-vietnam-pro', 'sans', '', 'bi', '5.3.0'),
  wf('Cabin', 'cabin', 'sans', '', 'bi', '5.3.0'),
  wf('Comfortaa', 'comfortaa', 'sans', '', 'b', '5.3.0'),
  wf('Didact Gothic', 'didact-gothic', 'sans', '', '', '5.3.0'),
  wf('DM Sans', 'dm-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Dosis', 'dosis', 'sans', '', 'b', '5.3.0'),
  wf('Exo 2', 'exo-2', 'sans', '', 'bi', '5.3.0'),
  wf('Figtree', 'figtree', 'sans', '', 'bi', '5.3.0'),
  wf('Fira Sans', 'fira-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Heebo', 'heebo', 'sans', '', 'b', '5.3.0'),
  wf('Hind', 'hind', 'sans', '', 'b', '5.3.0'),
  wf('IBM Plex Sans', 'ibm-plex-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Inter Tight', 'inter-tight', 'sans', '', 'bi', '5.3.0'),
  wf('Josefin Sans', 'josefin-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Jost', 'jost', 'sans', '', 'bi', '5.3.0'),
  wf('Kanit', 'kanit', 'sans', '', 'bi', '5.3.0'),
  wf('Karla', 'karla', 'sans', '', 'bi', '5.3.0'),
  wf('Lexend', 'lexend', 'sans', '', 'b', '5.3.0'),
  wf('Manrope', 'manrope', 'sans', '', 'b', '5.3.0'),
  wf('Maven Pro', 'maven-pro', 'sans', '', 'b', '5.3.0'),
  wf('Mulish', 'mulish', 'sans', '', 'bi', '5.3.0'),
  wf('Nunito Sans', 'nunito-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Outfit', 'outfit', 'sans', '', 'b', '5.3.0'),
  wf('Overpass', 'overpass', 'sans', '', 'bi', '5.3.0'),
  wf('Plus Jakarta Sans', 'plus-jakarta-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Prompt', 'prompt', 'sans', '', 'bi', '5.3.0'),
  wf('PT Sans Narrow', 'pt-sans-narrow', 'sans', '', 'b', '5.3.0'),
  wf('Public Sans', 'public-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Questrial', 'questrial', 'sans', '', '', '5.3.0'),
  wf('Quicksand', 'quicksand', 'sans', '', 'b', '5.3.0'),
  wf('Red Hat Display', 'red-hat-display', 'sans', '', 'bi', '5.3.0'),
  wf('Roboto Condensed', 'roboto-condensed', 'sans', '', 'bi', '5.3.0'),
  wf('Rubik', 'rubik', 'sans', '', 'bi', '5.3.0'),
  wf('Signika', 'signika', 'sans', '', 'b', '5.3.0'),
  wf('Sora', 'sora', 'sans', '', 'b', '5.3.0'),
  wf('Space Grotesk', 'space-grotesk', 'sans', '', 'b', '5.3.0'),
  wf('Titillium Web', 'titillium-web', 'sans', '', 'bi', '5.3.0'),
  wf('Ubuntu', 'ubuntu', 'sans', '', 'bi', '5.3.0'),
  wf('Urbanist', 'urbanist', 'sans', '', 'bi', '5.3.0'),
  wf('Varela Round', 'varela-round', 'sans', '', '', '5.3.0'),
  wf('Work Sans', 'work-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Alegreya', 'alegreya', 'serif', '', 'bi', '5.3.0'),
  wf('Arvo', 'arvo', 'serif', '', 'bi', '5.3.0'),
  wf('Bitter', 'bitter', 'serif', '', 'bi', '5.3.0'),
  wf('Bodoni Moda', 'bodoni-moda', 'serif', '', 'bi', '5.3.0'),
  wf('Cardo', 'cardo', 'serif', '', 'b', '5.3.0'),
  wf('Cinzel', 'cinzel', 'serif', '', 'b', '5.3.0'),
  wf('Cormorant', 'cormorant', 'serif', '', 'bi', '5.3.0'),
  wf('Cormorant Garamond', 'cormorant-garamond', 'serif', '', 'bi', '5.3.0'),
  wf('Crimson Pro', 'crimson-pro', 'serif', '', 'bi', '5.3.0'),
  wf('Crimson Text', 'crimson-text', 'serif', '', 'bi', '5.3.0'),
  wf('DM Serif Display', 'dm-serif-display', 'serif', '', 'i', '5.3.0'),
  wf('Domine', 'domine', 'serif', '', 'b', '5.3.0'),
  wf('Frank Ruhl Libre', 'frank-ruhl-libre', 'serif', '', 'b', '5.3.0'),
  wf('IBM Plex Serif', 'ibm-plex-serif', 'serif', '', 'bi', '5.3.0'),
  wf('Libre Baskerville', 'libre-baskerville', 'serif', '', 'bi', '5.3.0'),
  wf('Libre Bodoni', 'libre-bodoni', 'serif', '', 'bi', '5.3.0'),
  wf('Libre Caslon Text', 'libre-caslon-text', 'serif', '', 'b', '5.3.0'),
  wf('Lusitana', 'lusitana', 'serif', '', 'b', '5.3.0'),
  wf('Neuton', 'neuton', 'serif', '', 'b', '5.3.0'),
  wf('Noticia Text', 'noticia-text', 'serif', '', 'bi', '5.3.0'),
  wf('Old Standard TT', 'old-standard-tt', 'serif', '', 'b', '5.3.0'),
  wf('Playfair Display SC', 'playfair-display-sc', 'serif', '', 'bi', '5.3.0'),
  wf('Roboto Slab', 'roboto-slab', 'serif', '', 'b', '5.3.0'),
  wf('Rokkitt', 'rokkitt', 'serif', '', 'bi', '5.3.0'),
  wf('Source Serif 4', 'source-serif-4', 'serif', '', 'bi', '5.3.1'),
  wf('Spectral', 'spectral', 'serif', '', 'bi', '5.3.0'),
  wf('Vollkorn', 'vollkorn', 'serif', '', 'bi', '5.3.0'),
  wf('Zilla Slab', 'zilla-slab', 'serif', '', 'bi', '5.3.0'),
  wf('Anonymous Pro', 'anonymous-pro', 'mono', '', 'bi', '5.3.0'),
  wf('Courier Prime', 'courier-prime', 'mono', '', 'bi', '5.3.0'),
  wf('Cutive Mono', 'cutive-mono', 'mono', '', '', '5.3.0'),
  wf('DM Mono', 'dm-mono', 'mono', '', 'i', '5.3.0'),
  wf('Fira Code', 'fira-code', 'mono', '', 'b', '5.3.0'),
  wf('Fira Mono', 'fira-mono', 'mono', '', 'b', '5.3.0'),
  wf('IBM Plex Mono', 'ibm-plex-mono', 'mono', '', 'bi', '5.3.0'),
  wf('JetBrains Mono', 'jetbrains-mono', 'mono', '', 'bi', '5.3.0'),
  wf('Overpass Mono', 'overpass-mono', 'mono', '', 'b', '5.3.0'),
  wf('PT Mono', 'pt-mono', 'mono', '', '', '5.3.0'),
  wf('Share Tech Mono', 'share-tech-mono', 'mono', '', '', '5.3.0'),
  wf('Space Mono', 'space-mono', 'mono', '', 'bi', '5.3.0'),
  wf('Ubuntu Mono', 'ubuntu-mono', 'mono', '', 'bi', '5.3.0'),
  wf('VT323', 'vt323', 'mono', '', '', '5.3.0'),
  wf('Alex Brush', 'alex-brush', 'script', '', '', '5.3.0'),
  wf('Allura', 'allura', 'script', '', '', '5.3.0'),
  wf('Amatic SC', 'amatic-sc', 'script', '', 'b', '5.3.0'),
  wf('Architects Daughter', 'architects-daughter', 'script', '', '', '5.3.0'),
  wf('Cookie', 'cookie', 'script', '', '', '5.3.0'),
  wf('Courgette', 'courgette', 'script', '', '', '5.3.0'),
  wf('Covered By Your Grace', 'covered-by-your-grace', 'script', '', '', '5.3.0'),
  wf('Damion', 'damion', 'script', '', '', '5.3.0'),
  wf('Gloria Hallelujah', 'gloria-hallelujah', 'script', '', '', '5.3.0'),
  wf('Gochi Hand', 'gochi-hand', 'script', '', '', '5.3.0'),
  wf('Great Vibes', 'great-vibes', 'script', '', '', '5.3.0'),
  wf('Handlee', 'handlee', 'script', '', '', '5.3.0'),
  wf('Herr Von Muellerhoff', 'herr-von-muellerhoff', 'script', '', '', '5.3.0'),
  wf('Homemade Apple', 'homemade-apple', 'script', '', '', '5.3.0'),
  wf('Indie Flower', 'indie-flower', 'script', '', '', '5.3.0'),
  wf('Just Another Hand', 'just-another-hand', 'script', '', '', '5.3.0'),
  wf('Kalam', 'kalam', 'script', '', 'b', '5.3.0'),
  wf('Kaushan Script', 'kaushan-script', 'script', '', '', '5.3.0'),
  wf('Leckerli One', 'leckerli-one', 'script', '', '', '5.3.0'),
  wf('Lobster', 'lobster', 'script', '', '', '5.3.0'),
  wf('Marck Script', 'marck-script', 'script', '', '', '5.3.0'),
  wf('Norican', 'norican', 'script', '', '', '5.3.0'),
  wf('Pacifico', 'pacifico', 'script', '', '', '5.3.0'),
  wf('Pangolin', 'pangolin', 'script', '', '', '5.3.0'),
  wf('Parisienne', 'parisienne', 'script', '', '', '5.3.0'),
  wf('Patrick Hand', 'patrick-hand', 'script', '', '', '5.3.0'),
  wf('Permanent Marker', 'permanent-marker', 'script', '', '', '5.3.0'),
  wf('Pinyon Script', 'pinyon-script', 'script', '', '', '5.3.0'),
  wf('Reenie Beanie', 'reenie-beanie', 'script', '', '', '5.3.0'),
  wf('Rock Salt', 'rock-salt', 'script', '', '', '5.3.0'),
  wf('Sacramento', 'sacramento', 'script', '', '', '5.3.0'),
  wf('Satisfy', 'satisfy', 'script', '', '', '5.3.0'),
  wf('School Bell', 'schoolbell', 'script', '', '', '5.3.0'),
  wf('Shadows Into Light', 'shadows-into-light', 'script', '', '', '5.3.0'),
  wf('Special Elite', 'special-elite', 'script', '', '', '5.3.0'),
  wf('Tangerine', 'tangerine', 'script', '', 'b', '5.3.0'),
  wf('Yellowtail', 'yellowtail', 'script', '', '', '5.3.0'),
  wf('Abril Fatface', 'abril-fatface', 'display', '', '', '5.3.0'),
  wf('Alfa Slab One', 'alfa-slab-one', 'display', '', '', '5.3.0'),
  wf('Archivo Black', 'archivo-black', 'display', '', '', '5.3.0'),
  wf('Baloo 2', 'baloo-2', 'display', '', 'b', '5.3.0'),
  wf('Bangers', 'bangers', 'display', '', '', '5.3.0'),
  wf('Bebas Neue', 'bebas-neue', 'display', '', '', '5.3.0'),
  wf('Black Ops One', 'black-ops-one', 'display', '', '', '5.3.0'),
  wf('Bungee', 'bungee', 'display', '', '', '5.3.0'),
  wf('Chewy', 'chewy', 'display', '', '', '5.3.0'),
  wf('Fjalla One', 'fjalla-one', 'display', '', '', '5.3.0'),
  wf('Fredoka', 'fredoka', 'display', '', 'b', '5.3.0'),
  wf('Lilita One', 'lilita-one', 'display', '', '', '5.3.0'),
  wf('Luckiest Guy', 'luckiest-guy', 'display', '', '', '5.3.0'),
  wf('Monoton', 'monoton', 'display', '', '', '5.3.0'),
  wf('Passion One', 'passion-one', 'display', '', 'b', '5.3.0'),
  wf('Paytone One', 'paytone-one', 'display', '', '', '5.3.0'),
  wf('Press Start 2P', 'press-start-2p', 'display', '', '', '5.3.0'),
  wf('Righteous', 'righteous', 'display', '', '', '5.3.0'),
  wf('Russo One', 'russo-one', 'display', '', '', '5.3.0'),
  wf('Secular One', 'secular-one', 'display', '', '', '5.3.0'),
  wf('Staatliches', 'staatliches', 'display', '', '', '5.3.0'),
  wf('Teko', 'teko', 'display', '', 'b', '5.3.0'),
  wf('Titan One', 'titan-one', 'display', '', '', '5.3.0'),
  wf('Amiri', 'amiri', 'serif', '', 'bi', '5.3.0'),
  wf('Abhaya Libre', 'abhaya-libre', 'serif', '', 'b', '5.3.0'),
  wf('Aleo', 'aleo', 'serif', '', 'bi', '5.3.0'),
  wf('Audiowide', 'audiowide', 'display', '', '', '5.3.0'),
  wf('Atkinson Hyperlegible', 'atkinson-hyperlegible', 'sans', '', 'bi', '5.3.0'),
  wf('Arizonia', 'arizonia', 'script', '', '', '5.3.0'),
  wf('Anton SC', 'anton-sc', 'display', '', '', '5.3.0'),
  wf('Archivo Narrow', 'archivo-narrow', 'sans', '', 'bi', '5.3.0'),
  wf('Alike', 'alike', 'serif', '', '', '5.3.0'),
  wf('Asap Condensed', 'asap-condensed', 'sans', '', 'bi', '5.3.0'),
  wf('Anek Latin', 'anek-latin', 'sans', '', 'b', '5.3.0'),
  wf('Andada Pro', 'andada-pro', 'serif', '', 'bi', '5.3.0'),
  wf('Azeret Mono', 'azeret-mono', 'mono', '', 'bi', '5.3.0'),
  wf('B612 Mono', 'b612-mono', 'mono', '', 'bi', '5.3.0'),
  wf('Bad Script', 'bad-script', 'script', '', '', '5.3.0'),
  wf('Barlow Condensed', 'barlow-condensed', 'sans', '', 'bi', '5.3.0'),
  wf('Bai Jamjuree', 'bai-jamjuree', 'sans', '', 'bi', '5.3.0'),
  wf('Barlow Semi Condensed', 'barlow-semi-condensed', 'sans', '', 'bi', '5.3.0'),
  wf('Bigshot One', 'bigshot-one', 'display', '', '', '5.3.0'),
  wf('Black Han Sans', 'black-han-sans', 'display', '', '', '5.3.0'),
  wf('Bagel Fat One', 'bagel-fat-one', 'display', '', '', '5.3.0'),
  wf('Barriecito', 'barriecito', 'display', '', '', '5.3.0'),
  wf('Bowlby One', 'bowlby-one', 'display', '', '', '5.3.0'),
  wf('Bree Serif', 'bree-serif', 'serif', '', '', '5.3.0'),
  wf('Bungee Shade', 'bungee-shade', 'display', '', '', '5.3.0'),
  wf('Bungee Inline', 'bungee-inline', 'display', '', '', '5.3.0'),
  wf('Brygada 1918', 'brygada-1918', 'serif', '', 'bi', '5.3.0'),
  wf('Cabin Condensed', 'cabin-condensed', 'sans', '', 'b', '5.3.0'),
  wf('Cambo', 'cambo', 'serif', '', '', '5.3.0'),
  wf('Caveat Brush', 'caveat-brush', 'script', '', '', '5.3.0'),
  wf('Cedarville Cursive', 'cedarville-cursive', 'script', '', '', '5.3.0'),
  wf('Carter One', 'carter-one', 'display', '', '', '5.3.0'),
  wf('Catamaran', 'catamaran', 'sans', '', 'b', '5.3.0'),
  wf('Chango', 'chango', 'display', '', '', '5.3.0'),
  wf('Chivo', 'chivo', 'sans', '', 'bi', '5.3.0'),
  wf('Cinzel Decorative', 'cinzel-decorative', 'display', '', 'b', '5.3.0'),
  wf('Chonburi', 'chonburi', 'serif', '', '', '5.3.0'),
  wf('Coiny', 'coiny', 'display', '', '', '5.3.0'),
  wf('Commissioner', 'commissioner', 'sans', '', 'b', '5.3.0'),
  wf('Climate Crisis', 'climate-crisis', 'display', '', '', '5.3.0'),
  wf('Concert One', 'concert-one', 'display', '', '', '5.3.0'),
  wf('Cormorant SC', 'cormorant-sc', 'serif', '', 'b', '5.3.0'),
  wf('Cormorant Upright', 'cormorant-upright', 'serif', '', 'b', '5.3.0'),
  wf('Creepster', 'creepster', 'display', '', '', '5.3.0'),
  wf('Cormorant Infant', 'cormorant-infant', 'serif', '', 'bi', '5.3.0'),
  wf('Dawning of a New Day', 'dawning-of-a-new-day', 'script', '', '', '5.3.0'),
  wf('Days One', 'days-one', 'display', '', '', '5.3.0'),
  wf('Dela Gothic One', 'dela-gothic-one', 'display', '', '', '5.3.0'),
  wf('Eater', 'eater', 'display', '', '', '5.3.0'),
  wf('Elsie', 'elsie', 'display', '', '', '5.3.0'),
  wf('Diplomata', 'diplomata', 'display', '', '', '5.3.0'),
  wf('Euphoria Script', 'euphoria-script', 'script', '', '', '5.3.0'),
  wf('Emblema One', 'emblema-one', 'display', '', '', '5.3.0'),
  wf('Encode Sans', 'encode-sans', 'sans', '', 'b', '5.3.0'),
  wf('Fascinate', 'fascinate', 'display', '', '', '5.3.0'),
  wf('Epilogue', 'epilogue', 'sans', '', 'bi', '5.3.0'),
  wf('Faster One', 'faster-one', 'display', '', '', '5.3.0'),
  wf('Fragment Mono', 'fragment-mono', 'mono', '', 'i', '5.3.0'),
  wf('Faustina', 'faustina', 'serif', '', 'bi', '5.3.0'),
  wf('Fraunces', 'fraunces', 'serif', '', 'bi', '5.3.0'),
  wf('Fira Sans Condensed', 'fira-sans-condensed', 'sans', '', 'bi', '5.3.0'),
  wf('Frijole', 'frijole', 'display', '', '', '5.3.0'),
  wf('Fugaz One', 'fugaz-one', 'display', '', '', '5.3.0'),
  wf('Gantari', 'gantari', 'sans', '', 'bi', '5.3.0'),
  wf('Geist Mono', 'geist-mono', 'mono', '', 'bi', '5.3.0'),
  wf('Gaegu', 'gaegu', 'script', '', 'b', '5.3.0'),
  wf('Geologica', 'geologica', 'sans', '', 'b', '5.3.0'),
  wf('Gamja Flower', 'gamja-flower', 'script', '', '', '5.3.0'),
  wf('Gloock', 'gloock', 'serif', '', '', '5.3.0'),
  wf('Gorditas', 'gorditas', 'display', '', 'b', '5.3.0'),
  wf('Golos Text', 'golos-text', 'sans', '', 'b', '5.3.0'),
  wf('Gluten', 'gluten', 'display', '', 'b', '5.3.0'),
  wf('Gupter', 'gupter', 'serif', '', 'b', '5.3.0'),
  wf('Gravitas One', 'gravitas-one', 'display', '', '', '5.3.0'),
  wf('IBM Plex Sans Condensed', 'ibm-plex-sans-condensed', 'sans', '', 'bi', '5.3.0'),
  wf('Henny Penny', 'henny-penny', 'display', '', '', '5.3.0'),
  wf('IM Fell English', 'im-fell-english', 'serif', '', 'i', '5.3.0'),
  wf('Hanken Grotesk', 'hanken-grotesk', 'sans', '', 'bi', '5.3.0'),
  wf('Inclusive Sans', 'inclusive-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Inria Serif', 'inria-serif', 'serif', '', 'bi', '5.3.0'),
  wf('Instrument Sans', 'instrument-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Italianno', 'italianno', 'script', '', '', '5.3.0'),
  wf('Instrument Serif', 'instrument-serif', 'serif', '', 'i', '5.3.0'),
  wf('Jolly Lodger', 'jolly-lodger', 'display', '', '', '5.3.0'),
  wf('Hahmlet', 'hahmlet', 'serif', '', 'b', '5.3.0'),
  wf('Judson', 'judson', 'serif', '', 'b', '5.3.0'),
  wf('Kavoon', 'kavoon', 'display', '', '', '5.3.0'),
  wf('Julee', 'julee', 'script', '', '', '5.3.0'),
  wf('Itim', 'itim', 'script', '', '', '5.3.0'),
  wf('Knewave', 'knewave', 'display', '', '', '5.3.0'),
  wf('La Belle Aurore', 'la-belle-aurore', 'script', '', '', '5.3.0'),
  wf('League Gothic', 'league-gothic', 'display', '', '', '5.3.0'),
  wf('Kristi', 'kristi', 'script', '', '', '5.3.0'),
  wf('Kreon', 'kreon', 'serif', '', 'b', '5.3.0'),
  wf('Lemon', 'lemon', 'display', '', '', '5.3.0'),
  wf('Libre Caslon Display', 'libre-caslon-display', 'serif', '', '', '5.3.0'),
  wf('Lexend Deca', 'lexend-deca', 'sans', '', 'b', '5.3.0'),
  wf('Libre Franklin', 'libre-franklin', 'sans', '', 'bi', '5.3.0'),
  wf('Limelight', 'limelight', 'display', '', '', '5.3.0'),
  wf('Literata', 'literata', 'serif', '', 'bi', '5.3.0'),
  wf('Lobster Two', 'lobster-two', 'display', '', 'bi', '5.3.0'),
  wf('Londrina Solid', 'londrina-solid', 'display', '', '', '5.3.0'),
  wf('Mada', 'mada', 'sans', '', 'b', '5.3.0'),
  wf('Major Mono Display', 'major-mono-display', 'mono', '', '', '5.3.0'),
  wf('Marcellus', 'marcellus', 'serif', '', '', '5.3.0'),
  wf('Mali', 'mali', 'script', '', 'bi', '5.3.0'),
  wf('Marcellus SC', 'marcellus-sc', 'display', '', '', '5.3.0'),
  wf('Martel', 'martel', 'serif', '', 'b', '5.3.0'),
  wf('Martian Mono', 'martian-mono', 'mono', '', 'b', '5.3.0'),
  wf('Meddon', 'meddon', 'script', '', '', '5.3.0'),
  wf('Merienda', 'merienda', 'script', '', 'b', '5.3.0'),
  wf('Merriweather Sans', 'merriweather-sans', 'serif', '', 'bi', '5.3.0'),
  wf('M PLUS 1p', 'm-plus-1p', 'sans', '', 'b', '5.3.0'),
  wf('Metal Mania', 'metal-mania', 'display', '', '', '5.3.0'),
  wf('Modak', 'modak', 'display', '', '', '5.3.0'),
  wf('Monofett', 'monofett', 'display', '', '', '5.3.0'),
  wf('Mr Dafoe', 'mr-dafoe', 'script', '', '', '5.3.0'),
  wf('Mouse Memoirs', 'mouse-memoirs', 'display', '', '', '5.3.0'),
  wf('Mr De Haviland', 'mr-de-haviland', 'script', '', '', '5.3.0'),
  wf('Mochiy Pop One', 'mochiy-pop-one', 'display', '', '', '5.3.0'),
  wf('Mrs Saint Delafield', 'mrs-saint-delafield', 'script', '', '', '5.3.0'),
  wf('Mukta', 'mukta', 'sans', '', 'b', '5.3.0'),
  wf('Mynerve', 'mynerve', 'script', '', '', '5.3.0'),
  wf('Newsreader', 'newsreader', 'serif', '', 'bi', '5.3.0'),
  wf('Neucha', 'neucha', 'script', '', '', '5.3.0'),
  wf('Nothing You Could Do', 'nothing-you-could-do', 'script', '', '', '5.3.0'),
  wf('Nosifer', 'nosifer', 'display', '', '', '5.3.0'),
  wf('Niconne', 'niconne', 'script', '', '', '5.3.0'),
  wf('Nanum Pen Script', 'nanum-pen-script', 'script', '', '', '5.3.0'),
  wf('Nanum Gothic', 'nanum-gothic', 'sans', '', 'b', '5.3.0'),
  wf('Noto Sans', 'noto-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Noto Sans Display', 'noto-sans-display', 'sans', '', 'bi', '5.3.0'),
  wf('Noto Sans Mono', 'noto-sans-mono', 'mono', '', 'b', '5.3.0'),
  wf('Nova Mono', 'nova-mono', 'mono', '', '', '5.3.0'),
  wf('Oi', 'oi', 'display', '', '', '5.3.0'),
  wf('Noto Serif', 'noto-serif', 'serif', '', 'bi', '5.3.0'),
  wf('Oleo Script Swash Caps', 'oleo-script-swash-caps', 'display', '', 'b', '5.3.0'),
  wf('Oleo Script', 'oleo-script', 'script', '', 'b', '5.3.0'),
  wf('Onest', 'onest', 'sans', '', 'b', '5.3.1'),
  wf('Orbitron', 'orbitron', 'display', '', 'b', '5.3.0'),
  wf('Over the Rainbow', 'over-the-rainbow', 'script', '', '', '5.3.0'),
  wf('Oxygen', 'oxygen', 'sans', '', 'b', '5.3.0'),
  wf('Oxygen Mono', 'oxygen-mono', 'mono', '', '', '5.3.0'),
  wf('Pattaya', 'pattaya', 'display', '', '', '5.3.0'),
  wf('Patua One', 'patua-one', 'display', '', '', '5.3.0'),
  wf('Pirata One', 'pirata-one', 'display', '', '', '5.3.0'),
  wf('Petrona', 'petrona', 'serif', '', 'bi', '5.3.0'),
  wf('Playball', 'playball', 'script', '', '', '5.3.0'),
  wf('Pridi', 'pridi', 'display', '', 'b', '5.3.0'),
  wf('Poller One', 'poller-one', 'display', '', '', '5.3.0'),
  wf('Quattrocento Sans', 'quattrocento-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Racing Sans One', 'racing-sans-one', 'display', '', '', '5.3.0'),
  wf('Rammetto One', 'rammetto-one', 'display', '', '', '5.3.0'),
  wf('Qwigley', 'qwigley', 'script', '', '', '5.3.0'),
  wf('Ranchers', 'ranchers', 'display', '', '', '5.3.0'),
  wf('Rancho', 'rancho', 'script', '', '', '5.3.0'),
  wf('Noto Sans JP', 'noto-sans-jp', 'sans', '', 'b', '5.3.1'),
  wf('Rasa', 'rasa', 'serif', '', 'bi', '5.3.1'),
  wf('Readex Pro', 'readex-pro', 'sans', '', 'b', '5.3.0'),
  wf('Red Hat Text', 'red-hat-text', 'sans', '', 'bi', '5.3.0'),
  wf('Red Hat Mono', 'red-hat-mono', 'mono', '', 'bi', '5.3.0'),
  wf('Ribeye', 'ribeye', 'display', '', '', '5.3.0'),
  wf('Rouge Script', 'rouge-script', 'script', '', '', '5.3.0'),
  wf('Rubik Mono One', 'rubik-mono-one', 'display', '', '', '5.3.0'),
  wf('Rubik Glitch', 'rubik-glitch', 'display', '', '', '5.3.0'),
  wf('Ruslan Display', 'ruslan-display', 'display', '', '', '5.3.0'),
  wf('Rubik Puddles', 'rubik-puddles', 'display', '', '', '5.3.0'),
  wf('Rye', 'rye', 'display', '', '', '5.3.0'),
  wf('Sancreek', 'sancreek', 'display', '', '', '5.3.0'),
  wf('Saira', 'saira', 'sans', '', 'bi', '5.3.0'),
  wf('Schibsted Grotesk', 'schibsted-grotesk', 'sans', '', 'bi', '5.3.0'),
  wf('Sarabun', 'sarabun', 'sans', '', 'bi', '5.3.0'),
  wf('Shadows Into Light Two', 'shadows-into-light-two', 'script', '', '', '5.3.0'),
  wf('Short Stack', 'short-stack', 'script', '', '', '5.3.0'),
  wf('Seymour One', 'seymour-one', 'display', '', '', '5.3.0'),
  wf('Shrikhand', 'shrikhand', 'display', '', '', '5.3.0'),
  wf('Sigmar One', 'sigmar-one', 'display', '', '', '5.3.0'),
  wf('Smokum', 'smokum', 'display', '', '', '5.3.0'),
  wf('Slackey', 'slackey', 'display', '', '', '5.3.0'),
  wf('Single Day', 'single-day', 'script', '', '', '5.3.1'),
  wf('Sofia Sans', 'sofia-sans', 'sans', '', 'bi', '5.3.0'),
  wf('Sofia', 'sofia', 'script', '', '', '5.3.0'),
  wf('Sorts Mill Goudy', 'sorts-mill-goudy', 'serif', '', 'i', '5.3.0'),
  wf('Sometype Mono', 'sometype-mono', 'mono', '', 'bi', '5.3.0'),
  wf('Source Sans Pro', 'source-sans-pro', 'sans', '', 'bi', '5.3.0'),
  wf('Spline Sans Mono', 'spline-sans-mono', 'mono', '', 'bi', '5.3.0'),
  wf('Spicy Rice', 'spicy-rice', 'display', '', '', '5.3.0'),
  wf('Squada One', 'squada-one', 'display', '', '', '5.3.0'),
  wf('Sriracha', 'sriracha', 'script', '', '', '5.3.0'),
  wf('Sue Ellen Francisco', 'sue-ellen-francisco', 'script', '', '', '5.3.0'),
  wf('Stint Ultra Expanded', 'stint-ultra-expanded', 'display', '', '', '5.3.0'),
  wf('Swanky and Moo Moo', 'swanky-and-moo-moo', 'script', '', '', '5.3.0'),
  wf('Syne', 'syne', 'sans', '', 'b', '5.3.0'),
  wf('Tajawal', 'tajawal', 'sans', '', 'b', '5.3.0'),
  wf('Tilt Neon', 'tilt-neon', 'display', '', '', '5.3.0'),
  wf('Trade Winds', 'trade-winds', 'display', '', '', '5.3.0'),
  wf('Tilt Warp', 'tilt-warp', 'display', '', '', '5.3.0'),
  wf('Ultra', 'ultra', 'display', '', '', '5.3.0'),
  wf('Ubuntu Condensed', 'ubuntu-condensed', 'sans', '', '', '5.3.0'),
  wf('Trirong', 'trirong', 'serif', '', 'bi', '5.3.0'),
  wf('Unna', 'unna', 'serif', '', 'bi', '5.3.0'),
  wf('Unica One', 'unica-one', 'display', '', '', '5.3.0'),
  wf('Vast Shadow', 'vast-shadow', 'display', '', '', '5.3.0'),
  wf('Walter Turncoat', 'walter-turncoat', 'script', '', '', '5.3.0'),
  wf('Waiting for the Sunrise', 'waiting-for-the-sunrise', 'script', '', '', '5.3.0'),
  wf('Wendy One', 'wendy-one', 'display', '', '', '5.3.0'),
  wf('Warnes', 'warnes', 'display', '', '', '5.3.0'),
  wf('Xanh Mono', 'xanh-mono', 'mono', '', 'i', '5.3.0'),
  wf('Wix Madefor Text', 'wix-madefor-text', 'sans', '', 'bi', '5.3.0'),
  wf('Yesteryear', 'yesteryear', 'script', '', '', '5.3.0'),
  wf('Yantramanav', 'yantramanav', 'sans', '', 'b', '5.3.0'),
  wf('Yeseva One', 'yeseva-one', 'display', '', '', '5.3.0'),
  wf('Young Serif', 'young-serif', 'serif', '', '', '5.3.0'),
  wf('Yrsa', 'yrsa', 'serif', '', 'bi', '5.3.0'),
  wf('Zen Dots', 'zen-dots', 'display', '', '', '5.3.0'),
  wf('Zilla Slab Highlight', 'zilla-slab-highlight', 'serif', '', 'b', '5.3.0'),
  wf('Zeyada', 'zeyada', 'script', '', '', '5.3.0'),
];
const WEB = Object.fromEntries(WEBFONTS.map((f) => [f.name, f]));
const GENERIC = {
  sans: 'sans-serif',
  serif: 'serif',
  mono: 'monospace',
  script: 'cursive',
  display: 'sans-serif',
};
const wfVariant = (f, b, i) => ({
  w: b && f.bold ? 700 : 400,
  s: i && f.italic ? 'italic' : 'normal',
});
const wfUrl = (f, v) => `${FONT_CDN}${f.pkg}@${f.ver}/files/${f.pkg}-latin-${v.w}-${v.s}.woff`;
const cssFont = (name) =>
  CSSFONT[name] || (WEB[name] ? `"PW ${name}",${GENERIC[WEB[name].kind]}` : CSSFONT.Helvetica);

const fontData = new Map();
function fetchFont(url) {
  if (!fontData.has(url)) {
    fontData.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error('Font download failed (' + r.status + ')');
          return r.arrayBuffer();
        })
        .catch((e) => {
          fontData.delete(url);
          throw e;
        }),
    );
  }
  return fontData.get(url);
}
const previewState = {};
function ensurePreviewFont(name) {
  const f = WEB[name];
  if (!f || previewState[name]) return;
  previewState[name] = 'loading';
  const variants = new Map();
  for (const b of [false, true])
    for (const i of [false, true]) {
      const v = wfVariant(f, b, i);
      variants.set(v.w + v.s, v);
    }
  Promise.all(
    [...variants.values()].map(async (v) => {
      const face = new FontFace('PW ' + name, await fetchFont(wfUrl(f, v)), {
        weight: String(v.w),
        style: v.s,
      });
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => {
      previewState[name] = 'ready';
      S.pages.forEach(renderOverlay);
    })
    .catch(() => {
      previewState[name] = 'failed';
    });
}

const fontFallbacks = new Set();
async function getFont(doc, cache, fam, b, i) {
  fam = fam || 'Helvetica';
  const f = WEB[fam];
  if (f) {
    const v = wfVariant(f, b, i);
    const key = fam + v.w + v.s;
    try {
      if (!cache[key]) {
        await lib('fontkit');
        if (!doc._fontkit) {
          doc.registerFontkit(fontkit);
          doc._fontkit = true;
        }
        cache[key] = await doc.embedFont(await fetchFont(wfUrl(f, v)), { subset: true });
      }
      return cache[key];
    } catch (e) {
      console.warn('font', fam, e);
      fontFallbacks.add(fam);
      return getFont(doc, cache, 'Helvetica', b, i);
    }
  }
  const k = fam + (b ? 1 : 0) + (i ? 1 : 0);
  if (!cache[k])
    cache[k] = await doc.embedFont(StandardFonts[STD_FONTS[fam][(b ? 1 : 0) + (i ? 2 : 0)]]);
  return cache[k];
}
const GROUPS = [
  ['edit', 'Edit & annotate'],
  ['organize', 'Organize'],
  ['optimize', 'Optimize'],
  ['to-pdf', 'Convert to PDF'],
  ['from-pdf', 'Convert from PDF'],
];
const pdfAcc = 'application/pdf,.pdf';
const TOOLS = [];
const T = (t) => TOOLS.push(t);
T({
  id: 'edit-pdf',
  group: 'edit',
  name: 'Edit PDF',
  desc: 'Add text, images, shapes, comments and highlights. Edit existing text.',
  editor: 'select',
});
T({
  id: 'pdf-forms',
  group: 'edit',
  name: 'PDF forms',
  desc: 'Fill in the form fields of a PDF.',
  editor: 'forms',
});
T({
  id: 'sign',
  group: 'edit',
  name: 'Sign PDF',
  desc: 'Draw, type or upload a signature and place it on a page.',
  editor: 'sign',
});
T({
  id: 'redact',
  group: 'edit',
  name: 'Redact PDF',
  desc: 'Black out sensitive content. Redacted pages are flattened so the text is gone.',
  editor: 'redact',
});
T({
  id: 'rotate',
  group: 'edit',
  name: 'Rotate PDF',
  desc: 'Turn all pages or a selection by 90, 180 or 270 degrees.',
  accept: pdfAcc,
  opts: [
    {
      id: 'angle',
      label: 'Rotation',
      type: 'select',
      options: [
        ['90', '90° clockwise'],
        ['180', '180°'],
        ['270', '90° counter-clockwise'],
      ],
      def: '90',
    },
    {
      id: 'pages',
      label: 'Pages',
      type: 'text',
      def: '',
      hint: 'Leave empty for all. Example: 1-3, 5',
    },
  ],
  async run({ files, o }) {
    const d = await pdfLoad(files[0]);
    const n = d.getPageCount();
    const idx = o.pages.trim() ? parseRanges(o.pages, n) : [...Array(n).keys()];
    idx.forEach((i) => {
      const p = d.getPage(i);
      p.setRotation(degrees((p.getRotation().angle + +o.angle) % 360));
    });
    return [{ name: baseName(files[0].name) + '-rotated.pdf', data: await d.save() }];
  },
});
T({
  id: 'page-numbers',
  group: 'edit',
  name: 'Add page numbers',
  desc: 'Stamp page numbers in any corner or edge.',
  accept: pdfAcc,
  opts: [
    {
      id: 'pos',
      label: 'Position',
      type: 'select',
      options: [
        ['bc', 'Bottom center'],
        ['br', 'Bottom right'],
        ['bl', 'Bottom left'],
        ['tc', 'Top center'],
        ['tr', 'Top right'],
        ['tl', 'Top left'],
      ],
      def: 'bc',
    },
    {
      id: 'fmt',
      label: 'Format',
      type: 'select',
      options: [
        ['{n}', '1'],
        ['Page {n}', 'Page 1'],
        ['{n} / {t}', '1 / 10'],
        ['Page {n} of {t}', 'Page 1 of 10'],
      ],
      def: 'Page {n} of {t}',
    },
    { id: 'start', label: 'First number', type: 'number', def: 1, min: 0 },
    { id: 'from', label: 'Start on page', type: 'number', def: 1, min: 1 },
    { id: 'size', label: 'Font size', type: 'number', def: 11, min: 6, max: 48 },
    { id: 'margin', label: 'Margin (pt)', type: 'number', def: 28, min: 0, max: 200 },
    { id: 'color', label: 'Color', type: 'color', def: '#222222' },
  ],
  async run({ files, o }) {
    const d = await pdfLoad(files[0]);
    const f = await d.embedFont(StandardFonts.Helvetica);
    const n = d.getPageCount(),
      size = +o.size,
      m = +o.margin;
    d.getPages().forEach((p, i) => {
      if (i + 1 < +o.from) return;
      const g = geo(p),
        [W, H] = vsize(g);
      const num = +o.start + (i + 1 - +o.from);
      const txt = o.fmt.replace('{n}', num).replace('{t}', n + +o.start - 1);
      const w = f.widthOfTextAtSize(txt, size);
      const x = o.pos[1] === 'l' ? m : o.pos[1] === 'r' ? W - m - w : (W - w) / 2;
      const y = o.pos[0] === 't' ? m + size * 0.8 : H - m;
      const [ux, uy] = U(g, x, y);
      p.drawText(txt, {
        x: ux,
        y: uy,
        size,
        font: f,
        color: hex2rgb(o.color),
        rotate: degrees(g.r),
      });
    });
    return [{ name: baseName(files[0].name) + '-numbered.pdf', data: await d.save() }];
  },
});
T({
  id: 'watermark',
  group: 'edit',
  name: 'Add watermark',
  desc: 'Stamp text or an image across your pages.',
  accept: pdfAcc,
  opts: [
    { id: 'text', label: 'Watermark text', type: 'text', def: 'Confidential' },
    {
      id: 'img',
      label: 'Or watermark image (PNG or JPG)',
      type: 'file',
      accept: 'image/png,image/jpeg',
    },
    { id: 'size', label: 'Text size', type: 'number', def: 56, min: 8, max: 300 },
    {
      id: 'rot',
      label: 'Rotation',
      type: 'select',
      options: [
        ['0', '0°'],
        ['45', '45°'],
        ['90', '90°'],
        ['315', '-45°'],
      ],
      def: '45',
    },
    { id: 'op', label: 'Opacity %', type: 'number', def: 25, min: 5, max: 100 },
    { id: 'color', label: 'Color', type: 'color', def: '#c2261d' },
    {
      id: 'tile',
      label: 'Layout',
      type: 'select',
      options: [
        ['0', 'Single, centered'],
        ['1', 'Tiled'],
      ],
      def: '0',
    },
    { id: 'pages', label: 'Pages', type: 'text', def: '', hint: 'Leave empty for all pages' },
  ],
  async run({ files, o }) {
    const d = await pdfLoad(files[0]);
    const f = await d.embedFont(StandardFonts.HelveticaBold);
    const n = d.getPageCount();
    const idx = o.pages.trim() ? parseRanges(o.pages, n) : [...Array(n).keys()];
    let img = null;
    if (o.img) {
      const b = await o.img.arrayBuffer();
      img = o.img.type === 'image/png' ? await d.embedPng(b) : await d.embedJpg(b);
    }
    if (!img && !o.text.trim()) throw new Error('Enter watermark text or choose an image.');
    const rot = (+o.rot * Math.PI) / 180,
      op = +o.op / 100;
    for (const i of idx) {
      const p = d.getPage(i),
        g = geo(p),
        [W, H] = vsize(g);
      let w, h;
      const txt = sanitize(o.text);
      if (img) {
        const s = Math.min((W * 0.5) / img.width, (H * 0.5) / img.height);
        w = img.width * s;
        h = img.height * s;
      } else {
        w = f.widthOfTextAtSize(txt, +o.size);
        h = +o.size;
      }
      const spots =
        o.tile === '1'
          ? (() => {
              const a = [];
              const sx = w * 1.5 + 30,
                sy = h * 3 + 40;
              for (let y = sy / 2; y < H + sy; y += sy)
                for (let x = sx / 2; x < W + sx; x += sx) a.push([x, y]);
              return a;
            })()
          : [[W / 2, H / 2]];
      for (const [cx, cy] of spots) {
        const ca = Math.cos(rot),
          sa = Math.sin(rot);
        const vx = cx - (w / 2) * ca - (h / 2) * sa,
          vy = cy + (w / 2) * sa - (h / 2) * ca;
        const [ux, uy] = U(g, vx, vy);
        const ang = g.r - +o.rot;
        const args = { x: ux, y: uy, rotate: degrees(ang), opacity: op };
        if (img) p.drawImage(img, { ...args, width: w, height: h });
        else p.drawText(txt, { ...args, size: +o.size, font: f, color: hex2rgb(o.color) });
      }
    }
    return [{ name: baseName(files[0].name) + '-watermarked.pdf', data: await d.save() }];
  },
});
T({
  id: 'crop',
  group: 'edit',
  name: 'Crop PDF',
  desc: 'Trim margins from every page or a selection.',
  accept: pdfAcc,
  opts: [
    { id: 'top', label: 'Top (mm)', type: 'number', def: 10, min: 0 },
    { id: 'right', label: 'Right (mm)', type: 'number', def: 10, min: 0 },
    { id: 'bottom', label: 'Bottom (mm)', type: 'number', def: 10, min: 0 },
    { id: 'left', label: 'Left (mm)', type: 'number', def: 10, min: 0 },
    { id: 'pages', label: 'Pages', type: 'text', def: '', hint: 'Leave empty for all pages' },
  ],
  async run({ files, o }) {
    const d = await pdfLoad(files[0]);
    const n = d.getPageCount();
    const idx = o.pages.trim() ? parseRanges(o.pages, n) : [...Array(n).keys()];
    const mm = 72 / 25.4;
    for (const i of idx) {
      const p = d.getPage(i),
        g = geo(p),
        [W, H] = vsize(g);
      const l = +o.left * mm,
        t = +o.top * mm,
        r = +o.right * mm,
        b = +o.bottom * mm;
      if (l + r >= W || t + b >= H)
        throw new Error('Margins are larger than page ' + (i + 1) + '.');
      const a = U(g, l, t),
        c = U(g, W - r, H - b);
      const x = Math.min(a[0], c[0]),
        y = Math.min(a[1], c[1]),
        w = Math.abs(a[0] - c[0]),
        h = Math.abs(a[1] - c[1]);
      p.setCropBox(x, y, w, h);
    }
    return [{ name: baseName(files[0].name) + '-cropped.pdf', data: await d.save() }];
  },
});

T({
  id: 'merge',
  group: 'organize',
  name: 'Merge PDF',
  desc: 'Combine several PDFs into one, in the order you choose.',
  accept: pdfAcc,
  multi: true,
  minFiles: 2,
  sortable: true,
  async run({ files, progress }) {
    const out = await PDFDocument.create();
    let k = 0;
    for (const f of files) {
      const s = await pdfLoad(f);
      const pgs = await out.copyPages(s, s.getPageIndices());
      pgs.forEach((p) => out.addPage(p));
      progress(++k / files.length);
    }
    return [{ name: 'merged.pdf', data: await out.save() }];
  },
});
T({
  id: 'split',
  group: 'organize',
  name: 'Split PDF',
  desc: 'Cut a PDF by ranges, every N pages, or into single pages.',
  accept: pdfAcc,
  opts: [
    {
      id: 'mode',
      label: 'Split by',
      type: 'select',
      options: [
        ['ranges', 'Custom ranges'],
        ['every', 'Every N pages'],
        ['each', 'Every page'],
      ],
      def: 'ranges',
    },
    {
      id: 'ranges',
      label: 'Ranges',
      type: 'text',
      def: '1-3, 4-',
      hint: 'Each comma separated part becomes its own file',
      show: (o) => o.mode === 'ranges',
    },
    {
      id: 'n',
      label: 'Pages per file',
      type: 'number',
      def: 2,
      min: 1,
      show: (o) => o.mode === 'every',
    },
  ],
  async run({ files, o, progress }) {
    const s = await pdfLoad(files[0]);
    const n = s.getPageCount();
    let groups = [];
    if (o.mode === 'ranges') {
      groups = o.ranges
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => parseRanges(x, n))
        .filter((g) => g.length);
    } else if (o.mode === 'every') {
      for (let i = 0; i < n; i += +o.n)
        groups.push(Array.from({ length: Math.min(+o.n, n - i) }, (_, k) => i + k));
    } else groups = [...Array(n).keys()].map((i) => [i]);
    if (!groups.length) throw new Error('No pages match those ranges.');
    const res = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const d = await PDFDocument.create();
      (await d.copyPages(s, groups[gi])).forEach((p) => d.addPage(p));
      const a = groups[gi][0] + 1,
        b = groups[gi][groups[gi].length - 1] + 1;
      res.push({
        name: `${baseName(files[0].name)}-${a === b ? 'p' + a : 'p' + a + '-' + b}.pdf`,
        data: await d.save(),
      });
      progress((gi + 1) / groups.length);
    }
    return res;
  },
});
T({
  id: 'remove-pages',
  group: 'organize',
  name: 'Remove pages',
  desc: 'Delete the pages you do not need.',
  accept: pdfAcc,
  opts: [{ id: 'pages', label: 'Pages to remove', type: 'text', def: '', hint: 'Example: 2, 4-6' }],
  async run({ files, o }) {
    const d = await pdfLoad(files[0]);
    const n = d.getPageCount();
    const rm = parseRanges(o.pages, n);
    if (!rm.length) throw new Error('Enter at least one page to remove.');
    if (rm.length >= n) throw new Error('You cannot remove every page.');
    rm.reverse().forEach((i) => d.removePage(i));
    return [{ name: baseName(files[0].name) + '-trimmed.pdf', data: await d.save() }];
  },
});
T({
  id: 'extract-pages',
  group: 'organize',
  name: 'Extract pages',
  desc: 'Pull selected pages into a new PDF, or one file per page.',
  accept: pdfAcc,
  opts: [
    {
      id: 'pages',
      label: 'Pages to extract',
      type: 'text',
      def: '1-2',
      hint: 'Example: 1, 3-5',
    },
    {
      id: 'one',
      label: 'Output',
      type: 'select',
      options: [
        ['1', 'One PDF with these pages'],
        ['0', 'A separate PDF per page'],
      ],
      def: '1',
    },
  ],
  async run({ files, o }) {
    const s = await pdfLoad(files[0]);
    const idx = parseRanges(o.pages, s.getPageCount());
    if (!idx.length) throw new Error('No pages match.');
    const base = baseName(files[0].name);
    if (o.one === '1') {
      const d = await PDFDocument.create();
      (await d.copyPages(s, idx)).forEach((p) => d.addPage(p));
      return [{ name: base + '-extract.pdf', data: await d.save() }];
    }
    const res = [];
    for (const i of idx) {
      const d = await PDFDocument.create();
      d.addPage((await d.copyPages(s, [i]))[0]);
      res.push({ name: `${base}-p${i + 1}.pdf`, data: await d.save() });
    }
    return res;
  },
});
T({
  id: 'organize-pdf',
  group: 'organize',
  name: 'Organize PDF',
  desc: 'Reorder, rotate, duplicate, delete and insert pages with thumbnails.',
  editor: 'select',
});

T({
  id: 'compress',
  group: 'optimize',
  name: 'Compress PDF',
  desc: 'Make the file smaller. Stronger levels turn pages into compressed images.',
  accept: pdfAcc,
  opts: [
    {
      id: 'level',
      label: 'Level',
      type: 'select',
      options: [
        ['lossless', 'Light (keeps text and links)'],
        ['balanced', 'Recommended (page images, good quality)'],
        ['strong', 'Extreme (page images, smaller)'],
      ],
      def: 'lossless',
    },
  ],
  async run({ files, o, progress }) {
    const bytes = U8(await files[0].arrayBuffer());
    let best;
    if (o.level === 'lossless') {
      const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
      best = await d.save({ useObjectStreams: true });
    } else {
      const q = o.level === 'balanced' ? { s: 1.6, q: 0.72 } : { s: 1.1, q: 0.5 };
      const pj = await openPj(bytes);
      const out = await PDFDocument.create();
      for (let i = 0; i < pj.numPages; i++) {
        const pg = await pj.getPage(i + 1);
        const v1 = pg.getViewport({ scale: 1 });
        const c = await renderPdfPage(pj, i, q.s);
        const im = await out.embedJpg(await (await canvasBlob(c, 'image/jpeg', q.q)).arrayBuffer());
        out
          .addPage([v1.width, v1.height])
          .drawImage(im, { x: 0, y: 0, width: v1.width, height: v1.height });
        progress((i + 1) / pj.numPages);
      }
      best = await out.save();
    }
    const note =
      best.length < bytes.length
        ? `${fmtSize(bytes.length)} to ${fmtSize(best.length)}, ${Math.round((1 - best.length / bytes.length) * 100)}% smaller`
        : 'This file is already well optimized, so the original was kept.';
    return [
      {
        name: baseName(files[0].name) + '-compressed.pdf',
        data: best.length < bytes.length ? best : bytes,
        note,
      },
    ];
  },
});
T({
  id: 'repair',
  group: 'optimize',
  name: 'Repair PDF',
  desc: 'Rebuild a damaged PDF by copying its readable pages into a clean file.',
  accept: pdfAcc,
  async run({ files }) {
    const bytes = await files[0].arrayBuffer();
    let src;
    try {
      src = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
      });
    } catch (e) {
      throw new Error('This file is too damaged to read: ' + e.message);
    }
    const out = await PDFDocument.create();
    let ok = 0;
    for (const i of src.getPageIndices()) {
      try {
        out.addPage((await out.copyPages(src, [i]))[0]);
        ok++;
      } catch {}
    }
    if (!ok) throw new Error('No readable pages were found.');
    return [
      {
        name: baseName(files[0].name) + '-repaired.pdf',
        data: await out.save(),
        note: `Recovered ${ok} of ${src.getPageCount()} pages.`,
      },
    ];
  },
});

async function imgToEmbed(doc, file) {
  const b = await file.arrayBuffer();
  if (file.type === 'image/jpeg') return doc.embedJpg(b);
  if (file.type === 'image/png') return doc.embedPng(b);
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return doc.embedPng(await (await canvasBlob(c, 'image/png')).arrayBuffer());
}
T({
  id: 'jpg-to-pdf',
  group: 'to-pdf',
  name: 'JPG to PDF',
  desc: 'Turn images into a PDF, one image per page.',
  accept: 'image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp',
  multi: true,
  sortable: true,
  opts: [
    {
      id: 'size',
      label: 'Page size',
      type: 'select',
      options: [
        ['fit', 'Same as image'],
        ['a4', 'A4'],
        ['letter', 'US Letter'],
      ],
      def: 'a4',
    },
    {
      id: 'orient',
      label: 'Orientation',
      type: 'select',
      options: [
        ['auto', 'Automatic'],
        ['p', 'Portrait'],
        ['l', 'Landscape'],
      ],
      def: 'auto',
      show: (o) => o.size !== 'fit',
    },
    {
      id: 'margin',
      label: 'Margin',
      type: 'select',
      options: [
        ['0', 'None'],
        ['18', 'Small'],
        ['36', 'Big'],
      ],
      def: '18',
      show: (o) => o.size !== 'fit',
    },
  ],
  async run({ files, o, progress }) {
    const d = await PDFDocument.create();
    let k = 0;
    for (const f of files) {
      const im = await imgToEmbed(d, f);
      let W,
        H,
        m = 0;
      if (o.size === 'fit') {
        W = im.width;
        H = im.height;
      } else {
        [W, H] = o.size === 'a4' ? [595.28, 841.89] : [612, 792];
        m = +o.margin;
        const land = o.orient === 'l' || (o.orient === 'auto' && im.width > im.height);
        if (land) [W, H] = [H, W];
      }
      const p = d.addPage([W, H]);
      const s = Math.min((W - 2 * m) / im.width, (H - 2 * m) / im.height);
      const w = im.width * s,
        h = im.height * s;
      p.drawImage(im, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
      progress(++k / files.length);
    }
    return [{ name: 'images.pdf', data: await d.save() }];
  },
});

function layoutRuns(runs, fonts, size, maxW) {
  const toks = [];
  for (const r of runs) {
    if (r.br) {
      toks.push({ br: 1 });
      continue;
    }
    const f = fonts(r.bold, r.italic);
    for (const p of sanitize(r.t).split(/(\s+)/)) {
      if (p === '') continue;
      toks.push({ t: p, f, sp: /^\s+$/.test(p), u: r.u });
    }
  }
  const lines = [[]];
  let x = 0;
  for (const t of toks) {
    const L = lines[lines.length - 1];
    if (t.br) {
      lines.push([]);
      x = 0;
      continue;
    }
    const w = t.f.widthOfTextAtSize(t.t, size);
    if (t.sp) {
      if (x === 0) continue;
      L.push({ ...t, x, w });
      x += w;
      continue;
    }
    if (x + w > maxW && x > 0) {
      lines.push([]);
      x = 0;
    }
    lines[lines.length - 1].push({ ...t, x, w });
    x += w;
  }
  return lines.map((l) => {
    while (l.length && l[l.length - 1].sp) l.pop();
    return l;
  });
}
function htmlToBlocks(root) {
  const blocks = [];
  const BLOCK =
    /^(p|div|h[1-6]|ul|ol|li|table|blockquote|pre|hr|section|article|header|footer|main|figure)$/;
  const inline = (n, st, runs, imgs) => {
    if (n.nodeType === 3) {
      runs.push({ t: n.textContent.replace(/\s+/g, ' '), ...st });
      return;
    }
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();
    const s = { ...st };
    if (tag === 'strong' || tag === 'b') s.bold = true;
    if (tag === 'em' || tag === 'i') s.italic = true;
    if (tag === 'u' || tag === 'a') s.u = true;
    if (tag === 'br') {
      runs.push({ br: 1 });
      return;
    }
    if (tag === 'img') {
      imgs.push(n.getAttribute('src'));
      return;
    }
    n.childNodes.forEach((c) => inline(c, s, runs, imgs));
  };
  const para = (n, extra) => {
    const runs = [],
      imgs = [];
    inline(n, extra.st || {}, runs, imgs);
    if (runs.some((r) => r.br || (r.t && r.t.trim()))) blocks.push({ type: 'p', runs, ...extra });
    imgs.forEach((s) => blocks.push({ type: 'img', src: s }));
  };
  const walk = (parent, ctx) => {
    for (const n of parent.children) {
      const tag = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag))
        para(n, {
          size: [26, 22, 18, 16, 14, 12][+tag[1] - 1],
          st: { bold: true },
          before: 10,
          after: 6,
        });
      else if (tag === 'ul' || tag === 'ol') {
        let i = 0;
        for (const li of n.children) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          i++;
          const bullet = tag === 'ol' ? i + '.' : '•';
          const sub = Array.from(li.children).filter((c) => /^(ul|ol)$/i.test(c.tagName));
          const clone = li.cloneNode(true);
          clone.querySelectorAll('ul,ol').forEach((x) => x.remove());
          para(clone, { indent: 18 * (ctx.depth + 1), bullet, after: 2 });
          sub.forEach((s) => walk({ children: [s] }, { depth: ctx.depth + 1 }));
        }
      } else if (tag === 'table') {
        const rows = Array.from(n.querySelectorAll('tr')).map((tr) =>
          Array.from(tr.children).map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
        );
        if (rows.length) blocks.push({ type: 'table', rows });
      } else if (tag === 'hr') blocks.push({ type: 'hr' });
      else if (tag === 'img') blocks.push({ type: 'img', src: n.getAttribute('src') });
      else if (tag === 'pre')
        blocks.push({ type: 'p', runs: [{ t: n.textContent }], mono: true, after: 6 });
      else if (tag === 'blockquote') para(n, { indent: 20, st: { italic: true }, after: 6 });
      else if (
        BLOCK.test(tag) &&
        Array.from(n.children).some((c) => BLOCK.test(c.tagName.toLowerCase()))
      )
        walk(n, ctx);
      else if (tag !== 'script' && tag !== 'style' && tag !== 'head') para(n, { after: 6 });
    }
  };
  walk(root, { depth: 0 });
  return blocks;
}
async function blocksToPdf(blocks, { pageW = 595.28, pageH = 841.89, margin = 56 } = {}) {
  const doc = await PDFDocument.create();
  const FF = {};
  for (const k of [
    'Helvetica',
    'HelveticaBold',
    'HelveticaOblique',
    'HelveticaBoldOblique',
    'Courier',
  ])
    FF[k] = await doc.embedFont(StandardFonts[k]);
  const fonts = (b, i) =>
    FF[b ? (i ? 'HelveticaBoldOblique' : 'HelveticaBold') : i ? 'HelveticaOblique' : 'Helvetica'];
  let page = doc.addPage([pageW, pageH]),
    y = pageH - margin;
  const cw = pageW - 2 * margin;
  const np = () => {
    page = doc.addPage([pageW, pageH]);
    y = pageH - margin;
  };
  for (const b of blocks) {
    if (b.type === 'p') {
      const size = b.size || 11,
        lh = size * 1.35,
        ind = b.indent || 0;
      y -= b.before || 0;
      const f = b.mono ? () => FF.Courier : fonts;
      const lines = layoutRuns(b.runs, f, size, cw - ind - (b.bullet && !b.indent ? 18 : 0));
      lines.forEach((ln, li) => {
        if (y - lh < margin) np();
        y -= lh;
        if (li === 0 && b.bullet)
          page.drawText(sanitize(b.bullet), {
            x: margin + ind - 14,
            y: y + size * 0.25,
            size,
            font: FF.Helvetica,
            color: rgb(0.1, 0.1, 0.1),
          });
        for (const s of ln) {
          page.drawText(s.t, {
            x: margin + ind + s.x,
            y: y + size * 0.25,
            size,
            font: s.f,
            color: rgb(0.07, 0.07, 0.07),
          });
          if (s.u)
            page.drawLine({
              start: { x: margin + ind + s.x, y: y + size * 0.15 },
              end: { x: margin + ind + s.x + s.w, y: y + size * 0.15 },
              thickness: 0.6,
              color: rgb(0.2, 0.2, 0.5),
            });
        }
      });
      y -= b.after || 6;
    } else if (b.type === 'hr') {
      if (y < margin + 10) np();
      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + cw, y },
        thickness: 0.8,
        color: rgb(0.6, 0.6, 0.6),
      });
      y -= 12;
    } else if (b.type === 'img') {
      try {
        const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(b.src || '');
        if (!m) continue;
        const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        const im = /png/.test(m[1])
          ? await doc.embedPng(bin)
          : /jpe?g/.test(m[1])
            ? await doc.embedJpg(bin)
            : null;
        if (!im) continue;
        const s = Math.min(1, cw / im.width, (pageH - 2 * margin) / im.height);
        const w = im.width * s,
          h = im.height * s;
        if (y - h < margin) np();
        y -= h;
        page.drawImage(im, { x: margin, y, width: w, height: h });
        y -= 10;
      } catch {}
    } else if (b.type === 'table') {
      const nc = Math.max(...b.rows.map((r) => r.length));
      const colW = cw / nc,
        size = 9.5,
        lh = size * 1.3;
      for (const row of b.rows) {
        const cells = row.map((t) => wrapText(FF.Helvetica, size, sanitize(t), colW - 8));
        const rh = Math.max(...cells.map((c) => c.length), 1) * lh + 8;
        if (y - rh < margin) np();
        cells.forEach((lines, ci) => {
          page.drawRectangle({
            x: margin + ci * colW,
            y: y - rh,
            width: colW,
            height: rh,
            borderColor: rgb(0.7, 0.7, 0.7),
            borderWidth: 0.6,
          });
          lines.forEach((l, li) =>
            page.drawText(l, {
              x: margin + ci * colW + 4,
              y: y - 4 - (li + 1) * lh + size * 0.3,
              size,
              font: FF.Helvetica,
              color: rgb(0.1, 0.1, 0.1),
            }),
          );
        });
        y -= rh;
      }
      y -= 10;
    }
  }
  return doc.save();
}
T({
  id: 'word-to-pdf',
  group: 'to-pdf',
  name: 'Word to PDF',
  desc: 'Convert a .docx document to PDF.',
  accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  note: 'Text, headings, lists, tables and images are kept. Fonts are replaced with Helvetica and complex layouts are simplified.',
  async run({ files, progress }) {
    await lib('mammoth');
    progress(0.2);
    const res = await mammoth.convertToHtml(
      { arrayBuffer: await files[0].arrayBuffer() },
      {
        convertImage: mammoth.images.imgElement((i) =>
          i.read('base64').then((b) => ({ src: `data:${i.contentType};base64,${b}` })),
        ),
      },
    );
    progress(0.6);
    const doc = new DOMParser().parseFromString(res.value, 'text/html');
    const blocks = htmlToBlocks(doc.body);
    if (!blocks.length) throw new Error('The document has no readable content.');
    return [{ name: baseName(files[0].name) + '.pdf', data: await blocksToPdf(blocks) }];
  },
});
T({
  id: 'html-to-pdf',
  group: 'to-pdf',
  name: 'HTML to PDF',
  desc: 'Render an HTML file or pasted markup as a PDF.',
  accept: '.html,.htm,text/html',
  minFiles: 0,
  optionalFiles: true,
  note: 'Pages are rendered as images. Scripts do not run and external images, fonts or stylesheets are not loaded, so use inline styles and embedded images.',
  opts: [
    {
      id: 'src',
      label: 'Source',
      type: 'select',
      options: [
        ['file', 'HTML file'],
        ['paste', 'Paste HTML'],
      ],
      def: 'file',
    },
    {
      id: 'html',
      label: 'HTML',
      type: 'textarea',
      def: '<h1>Hello</h1>\n<p>Paste your markup here.</p>',
      show: (o) => o.src === 'paste',
    },
    {
      id: 'size',
      label: 'Page size',
      type: 'select',
      options: [
        ['a4', 'A4'],
        ['letter', 'US Letter'],
      ],
      def: 'a4',
    },
    {
      id: 'width',
      label: 'Render width (px)',
      type: 'number',
      def: 900,
      min: 320,
      max: 1600,
    },
    { id: 'margin', label: 'Margin (pt)', type: 'number', def: 28, min: 0, max: 120 },
  ],
  async run({ files, o, progress }) {
    let html = o.src === 'paste' ? o.html : files[0] ? await files[0].text() : '';
    if (!html.trim()) throw new Error('Add an HTML file or paste some markup.');
    await lib('html2canvas');
    progress(0.2);
    const fr = document.createElement('iframe');
    fr.setAttribute('sandbox', 'allow-same-origin');
    fr.style.cssText = `position:fixed;left:-99999px;top:0;width:${+o.width}px;height:600px;border:0;background:#fff`;
    fr.srcdoc = html;
    document.body.appendChild(fr);
    await new Promise((r) => {
      fr.onload = r;
      setTimeout(r, 4000);
    });
    const d = fr.contentDocument;
    fr.style.height = Math.max(600, d.documentElement.scrollHeight) + 'px';
    await new Promise((r) => setTimeout(r, 60));
    let cv;
    try {
      cv = await html2canvas(d.body, {
        scale: 1.5,
        backgroundColor: '#ffffff',
        windowWidth: +o.width,
        logging: false,
      });
    } finally {
      fr.remove();
    }
    progress(0.6);
    const [PW, PH] = o.size === 'a4' ? [595.28, 841.89] : [612, 792],
      M = +o.margin,
      cw = PW - 2 * M,
      s = cw / cv.width,
      sliceH = Math.floor((PH - 2 * M) / s);
    const out = await PDFDocument.create();
    for (let y = 0; y < cv.height; y += sliceH) {
      const h = Math.min(sliceH, cv.height - y);
      const c = document.createElement('canvas');
      c.width = cv.width;
      c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, h);
      x.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
      const im = await out.embedJpg(await (await canvasBlob(c, 'image/jpeg', 0.9)).arrayBuffer());
      out.addPage([PW, PH]).drawImage(im, { x: M, y: PH - M - h * s, width: cw, height: h * s });
    }
    return [{ name: 'page.pdf', data: await out.save() }];
  },
});
T({
  id: 'excel-to-pdf',
  group: 'to-pdf',
  name: 'Excel to PDF',
  desc: 'Convert each sheet of a spreadsheet into PDF pages.',
  accept: '.xlsx,.xls,.csv,.ods',
  note: 'Cell values are printed as shown. Column widths are fitted to the page and charts are not included.',
  opts: [
    {
      id: 'orient',
      label: 'Orientation',
      type: 'select',
      options: [
        ['auto', 'Automatic'],
        ['p', 'Portrait'],
        ['l', 'Landscape'],
      ],
      def: 'auto',
    },
  ],
  async run({ files, o, progress }) {
    await lib('xlsx');
    const wb = XLSX.read(await files[0].arrayBuffer(), { type: 'array' });
    const out = await PDFDocument.create();
    const F = await out.embedFont(StandardFonts.Helvetica),
      FB = await out.embedFont(StandardFonts.HelveticaBold);
    let any = false,
      si = 0;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1,
        raw: false,
        defval: '',
      });
      si++;
      if (!rows.length) continue;
      any = true;
      const nc = Math.max(...rows.map((r) => r.length));
      const wch = Array.from({ length: nc }, (_, c) =>
        clamp(Math.max(...rows.slice(0, 400).map((r) => String(r[c] ?? '').length), 3), 3, 40),
      );
      const land = o.orient === 'l' || (o.orient === 'auto' && nc > 6);
      const [PW, PH] = land ? [841.89, 595.28] : [595.28, 841.89];
      const M = 32;
      const sumw = wch.reduce((a, b) => a + b + 2, 0);
      const fs = clamp((PW - 2 * M) / (sumw * 0.5), 5, 10),
        rh = fs * 1.7;
      const colW = wch.map(
        (w) => (w + 2) * 0.5 * fs * Math.min(1, (PW - 2 * M) / (sumw * 0.5 * fs)),
      );
      let page, y;
      const head = () => {
        page = out.addPage([PW, PH]);
        page.drawText(sanitize(name), {
          x: M,
          y: PH - M + 8,
          size: 8,
          font: FB,
          color: rgb(0.4, 0.4, 0.4),
        });
        y = PH - M - 4;
      };
      head();
      const drawRow = (r, bold) => {
        if (y - rh < M) {
          head();
          if (ri > 0) drawRow(rows[0], true);
        }
        let x = M;
        for (let c = 0; c < nc; c++) {
          const f = bold ? FB : F;
          let t = sanitize(String(r[c] ?? '').replace(/\s+/g, ' '));
          while (t.length > 1 && f.widthOfTextAtSize(t, fs) > colW[c] - 4) t = t.slice(0, -1);
          page.drawRectangle({
            x,
            y: y - rh,
            width: colW[c],
            height: rh,
            borderColor: rgb(0.82, 0.82, 0.82),
            borderWidth: 0.4,
            color: bold ? rgb(0.94, 0.94, 0.96) : undefined,
          });
          page.drawText(t, {
            x: x + 2,
            y: y - rh + fs * 0.55,
            size: fs,
            font: f,
            color: rgb(0.1, 0.1, 0.1),
          });
          x += colW[c];
        }
        y -= rh;
      };
      var ri = 0;
      for (; ri < rows.length; ri++) drawRow(rows[ri], ri === 0);
      progress(si / wb.SheetNames.length);
    }
    if (!any) throw new Error('The spreadsheet is empty.');
    return [{ name: baseName(files[0].name) + '.pdf', data: await out.save() }];
  },
});
T({
  id: 'powerpoint-to-pdf',
  group: 'to-pdf',
  name: 'PowerPoint to PDF',
  desc: 'Convert a .pptx presentation into PDF pages.',
  accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
  note: 'Slide text, pictures and simple shape fills are kept in place. Themes, charts, SmartArt and animations are not reproduced.',
  async run({ files, progress }) {
    await lib('jszip');
    const zip = await JSZip.loadAsync(await files[0].arrayBuffer());
    const px = async (p) => {
      const f = zip.file(p);
      return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
    };
    const pres = await px('ppt/presentation.xml');
    if (!pres) throw new Error('This does not look like a .pptx file.');
    const sz = pres.getElementsByTagName('p:sldSz')[0];
    const PW = +sz.getAttribute('cx') / 12700,
      PH = +sz.getAttribute('cy') / 12700;
    const rel = await px('ppt/_rels/presentation.xml.rels');
    const rmap = {};
    Array.from(rel.getElementsByTagName('Relationship')).forEach(
      (r) => (rmap[r.getAttribute('Id')] = r.getAttribute('Target')),
    );
    const ids = Array.from(pres.getElementsByTagName('p:sldId')).map((e) => e.getAttribute('r:id'));
    const out = await PDFDocument.create();
    const F = {
      r: await out.embedFont(StandardFonts.Helvetica),
      b: await out.embedFont(StandardFonts.HelveticaBold),
    };
    const resolve = (base, t) => new URL(t, 'http://x/' + base).pathname.slice(1);
    const E = 12700;
    const xfrmOf = (e) => {
      const x = e.getElementsByTagName('a:xfrm')[0];
      if (!x) return null;
      const off = x.getElementsByTagName('a:off')[0],
        ext = x.getElementsByTagName('a:ext')[0];
      if (!off || !ext) return null;
      return {
        x: +off.getAttribute('x') / E,
        y: +off.getAttribute('y') / E,
        w: +ext.getAttribute('cx') / E,
        h: +ext.getAttribute('cy') / E,
      };
    };
    const phOf = (e) => {
      const p = e.getElementsByTagName('p:ph')[0];
      return p ? { type: p.getAttribute('type') || 'body', idx: p.getAttribute('idx') } : null;
    };
    const clr = (e) => {
      const s = e && e.getElementsByTagName('a:srgbClr')[0];
      return s ? hex2rgb('#' + s.getAttribute('val')) : null;
    };
    let k = 0;
    for (const rid of ids) {
      const sp = 'ppt/' + rmap[rid];
      const slide = await px(sp);
      if (!slide) continue;
      const srels = await px(sp.replace('slides/', 'slides/_rels/') + '.rels');
      const sm = {};
      let layoutDoc = null;
      if (srels)
        for (const r of Array.from(srels.getElementsByTagName('Relationship'))) {
          sm[r.getAttribute('Id')] = resolve(sp.replace(/[^/]*$/, ''), r.getAttribute('Target'));
          if (/slideLayout$/.test(r.getAttribute('Type')))
            layoutDoc = await px(sm[r.getAttribute('Id')]);
        }
      const page = out.addPage([PW, PH]);
      const bg = slide.getElementsByTagName('p:bg')[0];
      const bc = bg && clr(bg);
      if (bc) page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: bc });
      const shapes = Array.from(slide.getElementsByTagName('p:sp')).concat(
        Array.from(slide.getElementsByTagName('p:pic')),
      );
      for (const s of shapes) {
        let box = xfrmOf(s);
        const ph = phOf(s);
        if (!box && ph && layoutDoc) {
          const m = Array.from(layoutDoc.getElementsByTagName('p:sp')).find((x) => {
            const q = phOf(x);
            return q && ((ph.idx != null && q.idx === ph.idx) || q.type === ph.type);
          });
          if (m) box = xfrmOf(m);
        }
        if (!box) continue;
        const y = PH - box.y - box.h;
        if (s.tagName === 'p:pic') {
          const bl = s.getElementsByTagName('a:blip')[0];
          const path = bl && sm[bl.getAttribute('r:embed')];
          const f = path && zip.file(path);
          if (!f) continue;
          try {
            const b = await f.async('uint8array');
            const im = /\.png$/i.test(path)
              ? await out.embedPng(b)
              : /\.jpe?g$/i.test(path)
                ? await out.embedJpg(b)
                : null;
            if (im) page.drawImage(im, { x: box.x, y, width: box.w, height: box.h });
          } catch {}
          continue;
        }
        const spPr = s.getElementsByTagName('p:spPr')[0];
        const fill = spPr && Array.from(spPr.children).find((c) => c.tagName === 'a:solidFill');
        const fc = clr(fill);
        if (fc) page.drawRectangle({ x: box.x, y, width: box.w, height: box.h, color: fc });
        const paras = Array.from(s.getElementsByTagName('a:p'))
          .map((p) => {
            const runs = Array.from(p.getElementsByTagName('a:r')).map((r) => {
              const pr = r.getElementsByTagName('a:rPr')[0];
              return {
                t: r.getElementsByTagName('a:t')[0]?.textContent || '',
                sz: pr && pr.getAttribute('sz') ? +pr.getAttribute('sz') / 100 : null,
                b: pr && pr.getAttribute('b') === '1',
                c: clr(pr),
              };
            });
            const pp = p.getElementsByTagName('a:pPr')[0];
            return { runs, algn: (pp && pp.getAttribute('algn')) || 'l' };
          })
          .filter((p) => p.runs.length);
        if (!paras.length) continue;
        const base = ph && /title/i.test(ph.type) ? 32 : 18;
        let scale = 1,
          lines;
        const build = () => {
          lines = [];
          let th = 0;
          for (const p of paras) {
            const text = sanitize(p.runs.map((r) => r.t).join(''));
            const sz = (p.runs[0].sz || base) * scale;
            const f = p.runs[0].b || (ph && /title/i.test(ph.type)) ? F.b : F.r;
            const ls = wrapText(f, sz, text, box.w - 8);
            ls.forEach((l) => {
              lines.push({ l, sz, f, c: p.runs[0].c, algn: p.algn });
              th += sz * 1.2;
            });
          }
          return th;
        };
        while (build() > box.h && scale > 0.35) scale -= 0.1;
        let ty = PH - box.y - 4;
        for (const L of lines) {
          ty -= L.sz * 1.2;
          const w = L.f.widthOfTextAtSize(L.l, L.sz);
          const x =
            L.algn === 'ctr'
              ? box.x + (box.w - w) / 2
              : L.algn === 'r'
                ? box.x + box.w - w - 4
                : box.x + 4;
          page.drawText(L.l, {
            x,
            y: ty + L.sz * 0.25,
            size: L.sz,
            font: L.f,
            color: L.c || rgb(0.1, 0.1, 0.1),
          });
        }
      }
      progress(++k / ids.length);
    }
    if (!k) throw new Error('No slides were found.');
    return [{ name: baseName(files[0].name) + '.pdf', data: await out.save() }];
  },
});

async function pageLines(pj, i) {
  const page = await pj.getPage(i + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((t) => t.str && t.str.trim() !== '')
    .map((t) => {
      const tx = pdfjsLib.Util.transform(vp.transform, t.transform);
      return {
        s: t.str,
        x: tx[4],
        y: tx[5],
        w: t.width,
        size: Math.max(1, Math.hypot(tx[2], tx[3])),
      };
    });
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    let L = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.size * 0.45));
    if (!L) {
      L = { y: it.y, items: [], size: it.size };
      lines.push(L);
    }
    L.items.push(it);
    L.size = Math.max(L.size, it.size);
  }
  lines.sort((a, b) => a.y - b.y);
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    let t = '',
      end = null;
    const cells = [];
    let cur = null;
    for (const it of L.items) {
      const gap = end == null ? 0 : it.x - end;
      if (!cur || gap > L.size * 1.4) {
        cur = { x: it.x, text: it.s };
        cells.push(cur);
      } else
        cur.text +=
          (gap > L.size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.s) ? ' ' : '') + it.s;
      end = it.x + it.w;
    }
    L.cells = cells;
    L.text = cells
      .map((c) => c.text)
      .join('   ')
      .replace(/\s+$/, '');
    L.x = L.items[0].x;
    L.y1 = L.y;
  }
  return { lines, W: vp.width, H: vp.height };
}
function toParas(lines) {
  const paras = [];
  let cur = null;
  for (const L of lines) {
    if (
      cur &&
      Math.abs(L.size - cur.size) < 1.2 &&
      L.y - cur.lastY < L.size * 1.9 &&
      L.cells.length === 1 &&
      cur.single
    ) {
      cur.text += (/-$/.test(cur.text) ? '' : ' ') + L.text.trim();
      cur.lastY = L.y;
    } else {
      cur = { text: L.text.trim(), size: L.size, lastY: L.y, single: L.cells.length === 1 };
      paras.push(cur);
    }
  }
  return paras;
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] || 11;
};
T({
  id: 'pdf-to-jpg',
  group: 'from-pdf',
  name: 'PDF to JPG',
  desc: 'Save every page, or chosen pages, as JPG images.',
  accept: pdfAcc,
  opts: [
    {
      id: 'dpi',
      label: 'Quality',
      type: 'select',
      options: [
        ['72', 'Screen (72 dpi)'],
        ['150', 'Standard (150 dpi)'],
        ['300', 'High (300 dpi)'],
      ],
      def: '150',
    },
    { id: 'pages', label: 'Pages', type: 'text', def: '', hint: 'Leave empty for all pages' },
  ],
  async run({ files, o, progress }) {
    const bytes = U8(await files[0].arrayBuffer());
    const pj = await openPj(bytes);
    const idx = o.pages.trim() ? parseRanges(o.pages, pj.numPages) : [...Array(pj.numPages).keys()];
    const base = baseName(files[0].name);
    const res = [];
    for (let k = 0; k < idx.length; k++) {
      const c = await renderPdfPage(pj, idx[k], +o.dpi / 72);
      res.push({
        name: `${base}-${idx[k] + 1}.jpg`,
        data: await canvasBlob(c, 'image/jpeg', 0.92),
      });
      progress((k + 1) / idx.length);
    }
    return res;
  },
});
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
T({
  id: 'pdf-to-word',
  group: 'from-pdf',
  name: 'PDF to Word',
  desc: 'Extract the text of a PDF into an editable .docx.',
  accept: pdfAcc,
  note: 'Text, headings and paragraphs are rebuilt. Images and exact page layout are not carried over, and scanned PDFs without a text layer produce an empty document.',
  async run({ files, progress }) {
    await lib('jszip');
    const pj = await openPj(U8(await files[0].arrayBuffer()));
    const all = [];
    let body = [];
    for (let i = 0; i < pj.numPages; i++) {
      const { lines } = await pageLines(pj, i);
      all.push(lines);
      progress(((i + 1) / pj.numPages) * 0.7);
    }
    const bodySize = median(all.flat().map((l) => l.size));
    let total = 0;
    let xml = '';
    all.forEach((lines, i) => {
      const ps = toParas(lines);
      if (!ps.length && i > 0) return;
      ps.forEach((p, j) => {
        total++;
        const big = p.size > bodySize * 1.25;
        const sz = Math.round(clamp(p.size, 8, 36) * 2);
        xml += `<w:p><w:pPr>${i > 0 && j === 0 ? '<w:pageBreakBefore/>' : ''}<w:spacing w:after="120"/></w:pPr><w:r><w:rPr>${big ? '<w:b/>' : ''}<w:sz w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`;
      });
    });
    if (!total) throw new Error('No selectable text was found. This looks like a scanned PDF.');
    const z = new JSZip();
    z.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    z.file(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    z.file(
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        xml +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>',
    );
    return [
      {
        name: baseName(files[0].name) + '.docx',
        data: await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
      },
    ];
  },
});
T({
  id: 'pdf-to-powerpoint',
  group: 'from-pdf',
  name: 'PDF to PowerPoint',
  desc: 'Turn each PDF page into a slide.',
  accept: pdfAcc,
  opts: [
    {
      id: 'mode',
      label: 'Slide content',
      type: 'select',
      options: [
        ['img', 'Page images (exact look)'],
        ['text', 'Editable text boxes (no images)'],
      ],
      def: 'img',
    },
  ],
  async run({ files, o, progress }) {
    await lib('pptx');
    const pj = await openPj(U8(await files[0].arrayBuffer()));
    const p1 = await pj.getPage(1);
    const v = p1.getViewport({ scale: 1 });
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'PDFPAGE', width: v.width / 72, height: v.height / 72 });
    pptx.layout = 'PDFPAGE';
    for (let i = 0; i < pj.numPages; i++) {
      const s = pptx.addSlide();
      if (o.mode === 'img') {
        const c = await renderPdfPage(pj, i, 2);
        s.addImage({
          data: c.toDataURL('image/jpeg', 0.9),
          x: 0,
          y: 0,
          w: v.width / 72,
          h: v.height / 72,
        });
      } else {
        const { lines } = await pageLines(pj, i);
        for (const L of lines)
          for (const c of L.cells)
            s.addText(c.text, {
              x: c.x / 72,
              y: (L.y - L.size) / 72,
              w: Math.min(v.width - c.x, c.text.length * L.size * 0.62 + 14) / 72,
              h: (L.size * 1.4) / 72,
              fontSize: Math.round(L.size * 10) / 10,
              fontFace: 'Arial',
              margin: 0,
              valign: 'top',
              fit: 'none',
            });
      }
      progress((i + 1) / pj.numPages);
    }
    let data;
    try {
      data = await pptx.write({ outputType: 'uint8array' });
    } catch {
      data = await pptx.write('arraybuffer');
    }
    return [{ name: baseName(files[0].name) + '.pptx', data: U8(data) }];
  },
});
T({
  id: 'pdf-to-excel',
  group: 'from-pdf',
  name: 'PDF to Excel',
  desc: 'Detect rows and columns of text and write them into a workbook.',
  accept: pdfAcc,
  note: 'Works best on PDFs that contain tables as real text. Scanned pages have no text to read.',
  opts: [
    {
      id: 'sheets',
      label: 'Sheets',
      type: 'select',
      options: [
        ['page', 'One sheet per page'],
        ['one', 'All pages on one sheet'],
      ],
      def: 'page',
    },
    {
      id: 'num',
      label: 'Convert numbers',
      type: 'select',
      options: [
        ['1', 'Yes, store numeric text as numbers'],
        ['0', 'No, keep everything as text'],
      ],
      def: '1',
    },
  ],
  async run({ files, o, progress }) {
    await lib('xlsx');
    const pj = await openPj(U8(await files[0].arrayBuffer()));
    const pages = [];
    for (let i = 0; i < pj.numPages; i++) {
      pages.push((await pageLines(pj, i)).lines);
      progress(((i + 1) / pj.numPages) * 0.8);
    }
    const cols = [];
    const starts = pages
      .flat()
      .flatMap((l) => l.cells.map((c) => c.x))
      .sort((a, b) => a - b);
    for (const x of starts) {
      if (!cols.length || x - cols[cols.length - 1].max > 10) cols.push({ min: x, max: x });
      else cols[cols.length - 1].max = x;
    }
    const colOf = (x) => {
      let b = 0,
        bd = 1e9;
      cols.forEach((c, i) => {
        const d = Math.abs(x - (c.min + c.max) / 2);
        if (d < bd) {
          bd = d;
          b = i;
        }
      });
      return b;
    };
    const cell = (t) => {
      if (o.num === '1') {
        const s = t.trim().replace(/[$€£,\s]/g, '');
        if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return +s;
      }
      return t;
    };
    const rowsOf = (lines) =>
      lines.map((l) => {
        const r = Array(cols.length).fill('');
        l.cells.forEach((c) => {
          const k = colOf(c.x);
          r[k] = r[k] ? r[k] + ' ' + c.text : cell(c.text);
        });
        return r;
      });
    const wb = XLSX.utils.book_new();
    if (o.sheets === 'one')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pages.flatMap(rowsOf)), 'PDF');
    else
      pages.forEach((p, i) =>
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsOf(p)), 'Page ' + (i + 1)),
      );
    if (!pages.flat().length) throw new Error('No selectable text was found.');
    return [
      {
        name: baseName(files[0].name) + '.xlsx',
        data: U8(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })),
      },
    ];
  },
});
T({
  id: 'pdf-to-pdfa',
  group: 'from-pdf',
  name: 'PDF to PDF/A',
  desc: 'Make a self-contained archival copy of a PDF.',
  accept: pdfAcc,
  note: 'This flattens every page to an embedded image so fonts cannot go missing, and tags the file as PDF/A-2b in its metadata. It is not checked against the standard and has no color profile, so a strict validator may still reject it. Text will no longer be selectable.',
  async run({ files, progress }) {
    const bytes = U8(await files[0].arrayBuffer());
    const pj = await openPj(bytes);
    const out = await PDFDocument.create();
    for (let i = 0; i < pj.numPages; i++) {
      const pg = await pj.getPage(i + 1);
      const v = pg.getViewport({ scale: 1 });
      const c = await renderPdfPage(pj, i, 2);
      const im = await out.embedJpg(await (await canvasBlob(c, 'image/jpeg', 0.9)).arrayBuffer());
      out
        .addPage([v.width, v.height])
        .drawImage(im, { x: 0, y: 0, width: v.width, height: v.height });
      progress((i + 1) / pj.numPages);
    }
    const title = baseName(files[0].name);
    out.setTitle(title);
    out.setProducer('Pagewright');
    out.setCreator('Pagewright');
    const now = new Date().toISOString();
    const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title><xmp:CreateDate>${now}</xmp:CreateDate></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const stream = out.context.stream(new TextEncoder().encode(xmp), {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    out.catalog.set(PDFLib.PDFName.of('Metadata'), out.context.register(stream));
    return [{ name: baseName(files[0].name) + '-pdfa.pdf', data: await out.save() }];
  },
});
T({
  id: 'pdf-to-markdown',
  group: 'from-pdf',
  name: 'PDF to Markdown',
  desc: 'Extract the text of a PDF as Markdown with headings and lists.',
  accept: pdfAcc,
  async run({ files, progress }) {
    const pj = await openPj(U8(await files[0].arrayBuffer()));
    const all = [];
    for (let i = 0; i < pj.numPages; i++) {
      all.push((await pageLines(pj, i)).lines);
      progress((i + 1) / pj.numPages);
    }
    const body = median(all.flat().map((l) => l.size));
    const md = all
      .map((lines) =>
        toParas(lines)
          .map((p) => {
            const r = p.size / body;
            const t = p.text;
            if (r >= 1.7) return '# ' + t;
            if (r >= 1.35) return '## ' + t;
            if (r >= 1.15) return '### ' + t;
            if (/^[•·▪◦\-–]\s+/.test(t)) return '- ' + t.replace(/^[•·▪◦\-–]\s+/, '');
            return t;
          })
          .join('\n\n'),
      )
      .filter(Boolean)
      .join('\n\n---\n\n');
    if (!md.trim()) throw new Error('No selectable text was found.');
    return [{ name: baseName(files[0].name) + '.md', data: md }];
  },
});
const views = $$('[data-view]');
let curTool = null;
let skipGuard = false;
let lastRoute = '';
const routeKey = () => location.hash + '|' + JSON.stringify(history.state);
const inSession = () =>
  !!(S.bytes && history.state && history.state.pw === 'editor' && history.state.sess === S.sess);
const enterSession = () => history.pushState({ pw: 'editor', sess: S.sess }, '', '#edit-pdf');
function route() {
  if (routeKey() === lastRoute) return;
  lastRoute = routeKey();
  const id = (location.hash || '').slice(1);
  const t = TOOLS.find((x) => x.id === id);
  closeMega();
  if (S.bytes && !inSession()) {
    if (S.dirty && !skipGuard) {
      enterSession();
      lastRoute = routeKey();
      confirmLeave(() => {
        skipGuard = true;
        history.back();
      });
      return;
    }
    resetEditor();
  }
  skipGuard = false;
  fitSoon();
  curTool = t || null;
  views.forEach((v) => (v.hidden = true));
  $('#siteFoot').hidden = !!(t && t.editor);
  closeDrawer();
  if (!t) {
    $('#home').hidden = false;
    window.scrollTo(0, 0);
    document.title = 'Pagewright';
    return;
  }
  document.title = tl(t.name) + ' · Pagewright';
  if (t.editor) {
    $('#editorView').hidden = false;
    enterEditor(t.editor);
    return;
  }
  $('#toolView').hidden = false;
  openTool(t);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
document.addEventListener(
  'click',
  (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.dataset.keep || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey) return;
    if (!S.bytes || !S.dirty) return;
    const to = TOOLS.find((x) => '#' + x.id === a.getAttribute('href'));
    if (to && to.editor) return;
    e.preventDefault();
    closeMega();
    confirmLeave(() => {
      resetEditor();
      location.hash = a.getAttribute('href');
    });
  },
  true,
);

const TILES = {
  'edit-pdf': ['#5b50f0', 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
  'pdf-forms': [
    '#0d9488',
    'M9 3h6v3H9zM15 4.5h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2M9 14l2 2 4-4',
  ],
  sign: ['#2563eb', 'M3 18c2-7 4-9 5-7s-1 6 1 6 3-6 5-6 1.5 4 4 3M3 21h18'],
  redact: ['#334155', 'F:M3 6h18v4H3zM3 14h11v4H3z'],
  rotate: ['#d97706', 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5'],
  'page-numbers': ['#db2777', 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18'],
  watermark: ['#0284c7', 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z'],
  crop: ['#7c3aed', 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14'],
  merge: ['#ea580c', 'M6 3v4c0 3 3 5 6 5M18 3v4c0 3-3 5-6 5M12 12v8M9 17l3 3 3-3'],
  split: ['#dc2626', 'M12 3v18M8 12H3m3-3-3 3 3 3M16 12h5m-3-3 3 3-3 3'],
  'remove-pages': [
    '#9f1239',
    'M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4h6v3',
  ],
  'extract-pages': ['#16a34a', 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  'organize-pdf': ['#a21caf', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  compress: ['#4d7c0f', 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7'],
  repair: [
    '#78716c',
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  ],
};
const FILE_TYPES = {
  pdf: ['#e5483f', 'text:PDF:7'],
  doc: ['#2f6fdb', 'text:W:11'],
  xls: ['#1e8e50', 'text:X:11'],
  ppt: ['#e0622c', 'text:P:11'],
  pdfa: ['#b3203a', 'text:A:11'],
  md: ['#4b5a70', 'text:MD:7'],
  jpg: ['#a855d6', 'image'],
  html: ['#0e9fb0', 'code'],
};
const CONVERSIONS = {
  'jpg-to-pdf': ['jpg', 'pdf'],
  'pdf-to-jpg': ['pdf', 'jpg'],
  'word-to-pdf': ['doc', 'pdf'],
  'pdf-to-word': ['pdf', 'doc'],
  'excel-to-pdf': ['xls', 'pdf'],
  'pdf-to-excel': ['pdf', 'xls'],
  'powerpoint-to-pdf': ['ppt', 'pdf'],
  'pdf-to-powerpoint': ['pdf', 'ppt'],
  'html-to-pdf': ['html', 'pdf'],
  'pdf-to-pdfa': ['pdf', 'pdfa'],
  'pdf-to-markdown': ['pdf', 'md'],
};
const FILE_GLYPHS = {
  image:
    '<path d="M6.5 18l3.4-4.2 2.4 2.6 2.2-2.8 3 4.4z" fill="#fff"/><circle cx="9" cy="11.6" r="1.3" fill="#fff"/>',
  code: '<path d="M10 12.2l-2.6 2.6 2.6 2.6M14 12.2l2.6 2.6-2.6 2.6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};
function fileSvg(kind) {
  const [color, glyph] = FILE_TYPES[kind];
  let mark = FILE_GLYPHS[glyph] || '';
  if (glyph.startsWith('text:')) {
    const [, label, size] = glyph.split(':');
    mark = `<text x="12" y="${size > 8 ? 18.2 : 17.6}" text-anchor="middle" font-size="${size}" font-weight="800" fill="#fff" font-family="Geist,system-ui,sans-serif">${label}</text>`;
  }
  return `<svg class="file" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8.6L20 7.4V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="${color}"/><path d="M14.6 2v3.4a2 2 0 0 0 2 2H20z" fill="#fff" fill-opacity=".38"/>${mark}</svg>`;
}
const ARROW_SVG =
  '<svg class="to" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
function toolIcon(t) {
  const pair = CONVERSIONS[t.id];
  if (pair)
    return el('span', {
      class: 'ico pair',
      html: fileSvg(pair[0]) + ARROW_SVG + fileSvg(pair[1]),
    });
  const [color, glyph] = TILES[t.id] || ['#64748b', 'M5 4h10l4 4v12H5z'];
  const filled = glyph.startsWith('F:');
  const d = filled ? glyph.slice(2) : glyph;
  const paint = filled
    ? 'fill="#fff"'
    : 'fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  const [dx, dy] = glyphShift(d);
  return el('span', {
    class: 'ico tile',
    style: 'background:' + color,
    html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path transform="translate(${dx} ${dy})" d="${d}" ${paint}/></svg>`,
  });
}
let glyphProbe;
const glyphMemo = {};
function glyphShift(d) {
  if (glyphMemo[d]) return glyphMemo[d];
  let out = [0, 0];
  try {
    if (!glyphProbe) {
      glyphProbe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      glyphProbe.setAttribute('width', '24');
      glyphProbe.setAttribute('height', '24');
      glyphProbe.style.cssText = 'position:absolute;left:-99px;top:0;visibility:hidden';
      document.body.append(glyphProbe);
    }
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    glyphProbe.append(p);
    const b = p.getBBox();
    p.remove();
    if (b.width && b.height)
      out = [+(12 - (b.x + b.width / 2)).toFixed(2), +(12 - (b.y + b.height / 2)).toFixed(2)];
  } catch {}
  return (glyphMemo[d] = out);
}
function buildToolList(c) {
  GROUPS.forEach(([g, label]) => {
    const d = el('div', { class: 'mcol' }, el('h4', { text: label }));
    TOOLS.filter((t) => t.group === g).forEach((t) =>
      d.append(
        el(
          'a',
          { class: 'mi', href: '#' + t.id, 'data-id': t.id },
          toolIcon(t),
          el('span', { text: t.name }),
        ),
      ),
    );
    c.append(d);
  });
}
function buildMega() {
  buildToolList($('#megaCols'));
  buildToolList($('#drawerCols'));
}
const mega = $('#mega');
const megaBtn = $('#megaBtn');
let megaTimer;
let megaPointer = '';
function openMega() {
  fitSoon();
  clearTimeout(megaTimer);
  $$('.mi', mega).forEach((a) =>
    a.classList.toggle('cur', a.dataset.id === (curTool && curTool.id)),
  );
  mega.hidden = false;
  megaBtn.setAttribute('aria-expanded', 'true');
  placeMegaArrow();
}
function placeMegaArrow() {
  const card = $('.mega-card', mega);
  const b = megaBtn.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(mega).paddingLeft) || 16;
  const vw = document.documentElement.clientWidth;
  card.style.marginLeft = '0';
  const w = card.getBoundingClientRect().width;
  const center = b.left + b.width / 2;
  const left = Math.max(pad, (vw - w) / 2);
  card.style.marginLeft = left - pad + 'px';
  card.style.setProperty('--ax', clamp(center - left, 34, w - 34) + 'px');
}
window.addEventListener('resize', () => !mega.hidden && placeMegaArrow());
function closeMega() {
  clearTimeout(megaTimer);
  mega.hidden = true;
  megaBtn.setAttribute('aria-expanded', 'false');
}
const closeMegaSoon = () => {
  clearTimeout(megaTimer);
  megaTimer = setTimeout(closeMega, 220);
};
megaBtn.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && openMega());
megaBtn.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && closeMegaSoon());
mega.addEventListener('pointerenter', () => clearTimeout(megaTimer));
mega.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && closeMegaSoon());
megaBtn.addEventListener('pointerdown', (e) => (megaPointer = e.pointerType));
megaBtn.addEventListener('click', () => {
  if (megaPointer === 'mouse') openMega();
  else if (mega.hidden) openMega();
  else closeMega();
  megaPointer = '';
});
document.addEventListener('pointerdown', (e) => {
  if (!mega.hidden && !mega.contains(e.target) && !megaBtn.contains(e.target)) closeMega();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !mega.hidden) closeMega();
});
const themeBtn = $('#themeBtn');
const themeNow = () =>
  document.documentElement.getAttribute('data-theme') ||
  (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
function syncThemeBtn() {
  const dark = themeNow() === 'dark';
  $('.sun', themeBtn).toggleAttribute('hidden', dark);
  $('.moon', themeBtn).toggleAttribute('hidden', !dark);
  const label = tl(dark ? 'Switch to light theme' : 'Switch to dark theme');
  themeBtn.setAttribute('aria-label', label);
  themeBtn.title = label;
}
function applyTheme(t) {
  try {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  } catch {}
  syncThemeBtn();
}
try {
  applyTheme(localStorage.getItem('pw-theme'));
} catch {}
syncThemeBtn();
matchMedia('(prefers-color-scheme:dark)').addEventListener('change', syncThemeBtn);
themeBtn.onclick = () => {
  const n = themeNow() === 'dark' ? 'light' : 'dark';
  applyTheme(n);
  try {
    localStorage.setItem('pw-theme', n);
  } catch {}
};

function buildHome() {
  const nConv = TOOLS.filter((t) => t.group === 'to-pdf' || t.group === 'from-pdf').length;
  $('#stats').append(
    ...[
      [String(TOOLS.length), 'tools'],
      [String(nConv), 'conversions'],
    ].map(([n, l]) =>
      el('div', null, el('strong', { text: n }), el('span', { class: 'mono muted', text: l })),
    ),
  );
  const tabs = [
    [
      'Annotate and edit',
      'Mark up a PDF the way you would on paper, then change what is already there.',
      [
        'Text',
        'Images',
        'Shapes',
        'Free draw',
        'Highlight',
        'Underline',
        'Strikethrough',
        'Comments',
        'Edit existing text',
        'Whiteout',
        'Redact',
        'Signature',
        'Form filling',
        'Undo and redo',
      ],
    ],
    [
      'Convert to PDF',
      'Bring other formats into PDF.',
      TOOLS.filter((t) => t.group === 'to-pdf').map((t) => t.name),
    ],
    [
      'Convert from PDF',
      'Pull your content out into formats you can keep editing.',
      TOOLS.filter((t) => t.group === 'from-pdf').map((t) => t.name),
    ],
    [
      'Organize and optimize',
      'Shape the document itself.',
      TOOLS.filter((t) => t.group === 'organize' || t.group === 'optimize')
        .map((t) => t.name)
        .concat(['Rotate PDF', 'Page numbers', 'Watermark', 'Crop']),
    ],
  ];
  const tl = $('#homeTabs'),
    pn = $('#homePanel');
  const show = (i) => {
    $$('.tab', tl).forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    const [, desc, list] = tabs[i];
    pn.replaceChildren(
      el(
        'div',
        null,
        el('p', { text: desc }),
        el('a', {
          class: 'btn alt sm',
          href: ['#edit-pdf', '#jpg-to-pdf', '#pdf-to-jpg', '#merge'][i],
          text: 'Open →',
        }),
      ),
      el(
        'ul',
        { class: 'dots' },
        list.map((x) => el('li', { text: x })),
      ),
    );
    fitSoon();
  };
  tabs.forEach((t, i) =>
    tl.append(el('button', { class: 'tab', role: 'tab', text: t[0], onclick: () => show(i) })),
  );
  show(0);
  const all = $('#allTools');
  GROUPS.forEach(([g, label]) => {
    all.append(
      el(
        'div',
        { class: 'grp' },
        el('h3', { class: 'mono', text: label, style: 'margin:0;font-weight:500' }),
      ),
    );
    all.append(
      el(
        'div',
        { class: 'grid' },
        TOOLS.filter((t) => t.group === g).map((t) =>
          el(
            'a',
            { class: 'card', href: '#' + t.id },
            toolIcon(t),
            el('h3', { text: t.name }),
            el('p', { text: t.desc }),
            el('span', { class: 'go', text: 'Open →' }),
          ),
        ),
      ),
    );
  });
  wireDrop($('#homeDrop'), (fs) => {
    const f = fs.find((f) => /pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (f) startEditor(f);
    else toast('Choose a PDF file.');
  });
  $('#homeFile').onchange = (e) => {
    const f = e.target.files[0];
    if (f) startEditor(f);
    e.target.value = '';
  };
}
function wireDrop(node, cb) {
  ['dragenter', 'dragover'].forEach((ev) =>
    node.addEventListener(ev, (e) => {
      e.preventDefault();
      node.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    node.addEventListener(ev, (e) => {
      e.preventDefault();
      node.classList.remove('over');
    }),
  );
  node.addEventListener('drop', (e) => {
    cb(Array.from(e.dataTransfer.files || []));
  });
}
let TV = null;
function openTool(t) {
  curTool = t;
  TV = { t, files: [], o: {}, results: [] };
  const body = $('#toolBody');
  body.replaceChildren();
  const filesBox = el('div', { class: 'stack' });
  const optsBox = el('div', { class: 'opts' });
  const runRow = el('div', { class: 'row' });
  const status = el('div', { class: 'stack' });
  const resBox = el('div');
  body.append(
    el('a', { class: 'crumb', href: '#', text: '← All tools' }),
    el('h1', { text: t.name }),
    el('p', { class: 'lead', text: t.desc }),
  );
  if (t.note)
    body.append(el('div', { class: 'warn', text: t.note }), el('div', { style: 'height:20px' }));
  const input = el('input', {
    type: 'file',
    accept: t.accept || '',
    multiple: !!t.multi,
    hidden: true,
    id: 'toolFile',
  });
  const drop = el(
    'div',
    { class: 'drop' },
    el(
      'div',
      null,
      el('b', { text: t.multi ? 'Drop files here' : 'Drop a file here' }),
      el('div', {
        class: 'muted',
        text:
          (t.accept || '').includes('pdf') && !(t.accept || '').includes('image')
            ? 'PDF'
            : t.multi
              ? 'Choose one or more files'
              : 'Choose a file',
      }),
    ),
    el(
      'div',
      { class: 'row' },
      el('label', {
        class: 'btn',
        for: 'toolFile',
        text: t.multi ? 'Select files' : 'Select file',
      }),
      input,
    ),
  );
  const addFiles = (fs) => {
    fs = fs.filter((f) => accepts(t, f));
    if (!fs.length) {
      toast('That file type is not supported here.');
      return;
    }
    TV.files = t.multi ? TV.files.concat(fs) : fs.slice(0, 1);
    renderFiles();
  };
  input.onchange = (e) => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  };
  wireDrop(drop, addFiles);
  if (S.carry && (t.accept || '').includes('pdf')) {
    TV.files = [fileFromBytes(S.carry.bytes, S.carry.name)];
  }
  S.carry = null;
  const renderFiles = () => {
    filesBox.replaceChildren();
    if (TV.files.length) {
      const ul = el('ul', { class: 'files' });
      TV.files.forEach((f, i) => {
        const li = el(
          'li',
          null,
          el('span', { text: f.name }),
          el('span', {
            class: 'mono muted',
            style: 'flex:none;white-space:nowrap',
            text: fmtSize(f.size),
          }),
        );
        if (t.sortable && TV.files.length > 1) {
          li.append(
            el('button', {
              class: 'icon-btn',
              'aria-label': 'Move up',
              text: '↑',
              onclick: () => {
                if (i > 0) {
                  [TV.files[i - 1], TV.files[i]] = [TV.files[i], TV.files[i - 1]];
                  renderFiles();
                }
              },
            }),
            el('button', {
              class: 'icon-btn',
              'aria-label': 'Move down',
              text: '↓',
              onclick: () => {
                if (i < TV.files.length - 1) {
                  [TV.files[i + 1], TV.files[i]] = [TV.files[i], TV.files[i + 1]];
                  renderFiles();
                }
              },
            }),
          );
        }
        li.append(
          el('button', {
            class: 'icon-btn',
            'aria-label': 'Remove ' + f.name,
            text: '✕',
            onclick: () => {
              TV.files.splice(i, 1);
              renderFiles();
            },
          }),
        );
        ul.append(li);
      });
      filesBox.append(ul);
    }
    runBtn.disabled = !ready();
    resBox.replaceChildren();
  };
  const ready = () => (t.optionalFiles ? true : TV.files.length >= (t.minFiles || 1));
  const runBtn = el('button', { class: 'btn', text: 'Run ' + t.name, disabled: true });
  const readOpts = () => {
    const o = {};
    (t.opts || []).forEach((d) => {
      const n = $('#opt-' + d.id);
      if (!n) return;
      o[d.id] =
        d.type === 'file' ? n.files[0] || null : d.type === 'checkbox' ? n.checked : n.value;
    });
    return o;
  };
  const refreshShow = () => {
    const o = readOpts();
    (t.opts || []).forEach((d) => {
      const f = $('#fld-' + d.id);
      if (f && d.show) f.hidden = !d.show(o);
    });
  };
  (t.opts || []).forEach((d) => {
    let ctl;
    if (d.type === 'select')
      ctl = el(
        'select',
        { id: 'opt-' + d.id },
        d.options.map(([v, l]) => el('option', { value: v, text: l, selected: v === d.def })),
      );
    else if (d.type === 'textarea')
      ctl = el('textarea', { id: 'opt-' + d.id, spellcheck: 'false' });
    else if (d.type === 'file')
      ctl = el('input', { type: 'file', id: 'opt-' + d.id, accept: d.accept });
    else
      ctl = el('input', {
        type: d.type === 'color' ? 'color' : d.type === 'number' ? 'number' : 'text',
        id: 'opt-' + d.id,
        min: d.min,
        max: d.max,
        step: d.step,
      });
    if (d.type !== 'file' && d.type !== 'select') ctl.value = d.def ?? '';
    ctl.addEventListener('input', refreshShow);
    ctl.addEventListener('change', refreshShow);
    optsBox.append(
      el(
        'div',
        {
          class: 'field',
          id: 'fld-' + d.id,
          style: d.type === 'textarea' ? 'grid-column:1/-1' : null,
        },
        el('label', { for: 'opt-' + d.id, text: d.label }),
        ctl,
        d.hint ? el('span', { class: 'hint', text: d.hint }) : null,
      ),
    );
  });
  runRow.append(runBtn);
  runBtn.onclick = async () => {
    status.replaceChildren();
    resBox.replaceChildren();
    runBtn.disabled = true;
    const bar = el('div', { class: 'bar' }, el('i'));
    status.append(bar, el('span', { class: 'muted', text: 'Working…' }));
    try {
      const o = readOpts();
      const res = await t.run({
        files: TV.files,
        o,
        progress: (p) => {
          bar.firstChild.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
        },
      });
      bar.firstChild.style.width = '100%';
      status.replaceChildren();
      showResults(res, resBox);
    } catch (e) {
      console.error(e);
      status.replaceChildren(
        el('div', {
          class: 'warn',
          style: 'border-color:var(--danger)',
          text: e.message || String(e),
        }),
      );
    } finally {
      runBtn.disabled = !ready();
    }
  };
  body.append(
    el(
      'div',
      { class: 'stack' },
      drop,
      filesBox,
      t.opts && t.opts.length ? el('div', { class: 'panel' }, optsBox) : null,
      runRow,
      status,
      resBox,
    ),
  );
  refreshShow();
  renderFiles();
}
function accepts(t, f) {
  if (!t.accept) return true;
  return (
    t.accept.split(',').some((a) => {
      a = a.trim();
      if (a.startsWith('.')) return f.name.toLowerCase().endsWith(a);
      if (a.endsWith('/*')) return f.type.startsWith(a.slice(0, -1));
      return f.type === a;
    }) ||
    (!f.type && true)
  );
}
function showResults(res, box) {
  box.replaceChildren();
  const dl = el('div', { class: 'stack' });
  res.forEach((r) => {
    const size = r.data.size ?? r.data.length ?? r.data.byteLength;
    const row = el(
      'div',
      { class: 'result' },
      el(
        'div',
        { class: 'nm' },
        el('div', { text: r.name }),
        el('div', {
          class: 'mono muted',
          text: fmtSize(size) + (r.note ? ' · ' + r.note : ''),
        }),
      ),
      el('button', {
        class: 'btn sm',
        text: 'Download',
        onclick: () => offer(r.name, r.data),
      }),
    );
    if (/\.pdf$/i.test(r.name) && !(r.data instanceof Blob))
      row.append(
        el('button', {
          class: 'btn alt sm',
          text: 'Open in editor',
          onclick: () => startEditor(fileFromBytes(r.data, r.name)),
        }),
      );
    dl.append(row);
  });
  if (res.length > 1)
    dl.append(
      el(
        'div',
        { class: 'row', style: 'padding-top:12px' },
        el('button', {
          class: 'btn',
          text: 'Download all as ZIP',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await lib('jszip');
              const z = new JSZip();
              res.forEach((r) => z.file(r.name, r.data));
              await offer(
                (baseName(res[0].name).replace(/-\w*\d+(-\d+)?$/, '') || 'files') + '.zip',
                await z.generateAsync({ type: 'uint8array' }),
              );
            } catch (err) {
              toast(err.message);
            }
            e.target.disabled = false;
          },
        }),
      ),
    );
  box.append(el('div', { class: 'mono muted', style: 'margin:8px 0', text: 'Done' }), dl);
}
const S = {
  bytes: null,
  name: '',
  doc: null,
  pages: [],
  zoom: 1.2,
  tool: 'select',
  sel: null,
  undo: [],
  redo: [],
  form: {},
  fields: [],
  imgs: {},
  place: null,
  editing: null,
  dirty: false,
  carry: null,
  def: {
    color: '#000000',
    font: 'Helvetica',
    size: 16,
    bold: false,
    italic: false,
    under: false,
    strike: false,
    ls: 0,
    align: 'left',
    stroke: '#d11f1f',
    fill: '#ffd23f',
    sw: 2,
    op: 1,
    hl: '#ffe14d',
  },
};
const pw = (p) => (p.rot % 180 ? p.h : p.w),
  ph = (p) => (p.rot % 180 ? p.w : p.h);
const pageById = (id) => S.pages.find((p) => p.id === id);
const findEl = (id) => {
  for (const p of S.pages) {
    const e = p.els.find((x) => x.id === id);
    if (e) return { p, el: e };
  }
  return null;
};
const snap = () => JSON.stringify(S.pages);
function pushUndo() {
  S.dirty = true;
  S.undo.push(snap());
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
  updBar();
}
function doUndo() {
  if (!S.undo.length) return;
  S.dirty = true;
  S.redo.push(snap());
  S.pages = JSON.parse(S.undo.pop());
  S.sel = null;
  renderStage();
  updBar();
}
function doRedo() {
  if (!S.redo.length) return;
  S.dirty = true;
  S.undo.push(snap());
  S.pages = JSON.parse(S.redo.pop());
  S.sel = null;
  renderStage();
  updBar();
}

const TOOLBAR = [
  ['select', 'Select'],
  ['edittext', 'Edit text'],
  ['text', 'Text'],
  ['image', 'Image'],
  ['draw', 'Draw'],
  ['highlight', 'Highlight'],
  ['underline', 'Underline'],
  ['strike', 'Strikethrough'],
  ['rect', 'Rectangle'],
  ['ellipse', 'Ellipse'],
  ['line', 'Line'],
  ['arrow', 'Arrow'],
  ['whiteout', 'Whiteout'],
  ['redact', 'Redact'],
  ['note', 'Comment'],
  ['sign', 'Sign'],
];
const BAR_ICONS = {
  pages: 'M4 5h16v14H4zM9 5v14',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  props: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
  close: 'M6 6l12 12M18 6L6 18',
};
function barButton(cls, icon, label, short, props) {
  const b = el('button', { class: cls + ' tb-ic', 'aria-label': label, title: label, ...props });
  b.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${BAR_ICONS[icon]}"/></svg>` +
    `<span class="bl">${short || label}</span>`;
  return b;
}
function buildBar() {
  const b = $('#edBar');
  const tools = el(
    'div',
    { class: 'ed-tools', role: 'toolbar', 'aria-label': 'Tools' },
    ...TOOLBAR.map(([id, l]) =>
      el('button', {
        class: 'tb',
        'data-tool': id,
        'aria-pressed': 'false',
        text: l,
        onclick: () => setTool(id),
      }),
    ),
  );
  const toggle = (id, icon, label, panel, other) =>
    barButton('tb ed-toggle', icon, label, '', {
      id,
      onclick: () => {
        $(panel).classList.toggle('open');
        $(other).classList.remove('open');
      },
    });
  const actions = el(
    'div',
    { class: 'ed-actions' },
    toggle('btnPages', 'pages', 'Pages', '#thumbs', '#side'),
    barButton('tb', 'undo', 'Undo', '', { id: 'btnUndo', onclick: doUndo }),
    barButton('tb', 'redo', 'Redo', '', { id: 'btnRedo', onclick: doRedo }),
    el('span', { class: 'sep' }),
    el('button', {
      class: 'tb tb-z',
      'aria-label': 'Zoom out',
      text: '−',
      onclick: () => setZoom(S.zoom / 1.15),
    }),
    el('span', { class: 'mono', id: 'zoomLab' }),
    el('button', {
      class: 'tb tb-z',
      'aria-label': 'Zoom in',
      text: '+',
      onclick: () => setZoom(S.zoom * 1.15),
    }),
    el('button', { class: 'tb fit-btn', text: 'Fit', onclick: fitWidth }),
    toggle('btnProps', 'props', 'Properties', '#side', '#thumbs'),
    el('span', { style: 'flex:1' }),
    barButton('btn alt sm', 'close', 'Close PDF', '', { id: 'btnClose', onclick: closeEditor }),
    el('button', {
      class: 'btn sm',
      id: 'btnDl',
      html: '<span>Download<span class="x"> PDF</span></span>',
      onclick: downloadPdf,
    }),
  );
  b.replaceChildren(tools, actions);
}
function updBar() {
  const u = $('#btnUndo'),
    r = $('#btnRedo');
  if (u) u.disabled = !S.undo.length;
  if (r) r.disabled = !S.redo.length;
  $('#zoomLab') && ($('#zoomLab').textContent = Math.round(S.zoom * 100) + '%');
  $$('.tb[data-tool]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool)),
  );
  const on = $('.tb[data-tool][aria-pressed="true"]');
  const row = $('.ed-tools');
  if (on && row && row.scrollWidth > row.clientWidth)
    row.scrollTo({
      left: on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2,
      behavior: 'smooth',
    });
}
function setTool(t) {
  if (t === 'image') {
    pickImage();
    return;
  }
  if (t === 'sign') {
    openSign();
    return;
  }
  S.tool = t;
  S.place = null;
  $('#stage').dataset.tool = t;
  updBar();
  drawTextLayers();
  if (t !== 'select' && t !== 'forms') deselect();
}
function setZoom(z) {
  S.zoom = clamp(z, 0.3, 4);
  renderStage();
  updBar();
}
function fitWidth() {
  const first = S.pages[0];
  if (!first) return;
  const avail = $('#stage').clientWidth - 40;
  setZoom(clamp(avail / pw(first), 0.4, 1.5));
}

function enterEditor(preset) {
  if (S.bytes) {
    $('#edEmpty').hidden = true;
    $('#edApp').hidden = false;
    if (!$('#edBar').children.length) buildBar();
    updBar();
    if (preset === 'forms') {
      S.panelFocus = 'forms';
    } else S.panelFocus = null;
    if (preset === 'sign') openSign();
    else if (preset === 'redact') setTool('redact');
    else if (preset === 'select' || preset === 'forms') setTool('select');
    renderSide();
  } else {
    $('#edEmpty').hidden = false;
    $('#edApp').hidden = true;
  }
}
async function startEditor(file) {
  try {
    toast('Opening ' + file.name + '…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openPdfBytes(bytes, file.name);
    S.sess = (S.sess || 0) + 1;
    enterSession();
    route();
    fitWidth();
  } catch (e) {
    console.error(e);
    toast('Could not open that PDF: ' + (e.message || e), 6000);
  }
}
async function openPdfBytes(bytes, name) {
  const doc = await openPj(bytes);
  const pages = [];
  for (let i = 0; i < doc.numPages; i++) {
    const pg = await doc.getPage(i + 1);
    const v = pg.getViewport({ scale: 1, rotation: 0 });
    const v0 = pg.getViewport({ scale: 1 });
    pages.push({
      id: uid(),
      src: i,
      rot: 0,
      nat: pg.rotate % 360,
      w: v0.width,
      h: v0.height,
      els: [],
    });
  }
  S.bytes = bytes;
  S.name = name;
  S.dirty = true;
  S.doc = doc;
  S.pages = pages;
  S.sel = null;
  S.undo = [];
  S.redo = [];
  S.form = {};
  S.tool = 'select';
  S.imgs = S.imgs || {};
  thumbCache.clear();
  await loadForm();
  $('#edEmpty').hidden = true;
  $('#edApp').hidden = false;
  if (!$('#edBar').children.length) buildBar();
  const first = pages[0];
  S.zoom = clamp(Math.min(1.4, ($('#stage').clientWidth - 40) / (first.w || 600)), 0.4, 2);
  renderStage();
  updBar();
}
$('#edFile').onchange = (e) => {
  const f = e.target.files[0];
  if (f) startEditor(f);
  e.target.value = '';
};
wireDrop($('#edDrop'), (fs) => {
  const f = fs.find((f) => /pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (f) startEditor(f);
  else toast('Choose a PDF file.');
});
wireDrop($('#stage'), (fs) => {
  const f = fs[0];
  if (f && f.type.startsWith('image/')) importImage(f);
});

const io = new IntersectionObserver(
  (es) =>
    es.forEach((e) => {
      if (e.isIntersecting) drawCanvas(e.target.closest('.pgw'));
    }),
  { root: null, rootMargin: '800px 0px' },
);
function buildPageWrap(p) {
  const w = el('div', { class: 'pgw', 'data-id': p.id });
  const W = pw(p) * S.zoom,
    H = ph(p) * S.zoom;
  const pg = el(
    'div',
    { class: 'pg', style: `width:${W}px;height:${H}px` },
    el('canvas'),
    el('div', { class: 'tl' }),
    el('div', { class: 'ov' }),
  );
  w.append(pg, el('div', { class: 'lab' }));
  io.observe(pg);
  return w;
}
async function drawCanvas(w) {
  if (!w || !w.isConnected) return;
  const p = pageById(w.dataset.id);
  if (!p || w._drawn === w._key) return;
  w._drawn = w._key;
  const cnv = w.querySelector('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = pw(p) * S.zoom,
    H = ph(p) * S.zoom;
  cnv.width = Math.round(W * dpr);
  cnv.height = Math.round(H * dpr);
  cnv.style.width = W + 'px';
  cnv.style.height = H + 'px';
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  if (p.src < 0) return;
  try {
    const page = await S.doc.getPage(p.src + 1);
    const vp = page.getViewport({ scale: S.zoom * dpr, rotation: (p.nat + p.rot) % 360 });
    if (w._task)
      try {
        w._task.cancel();
      } catch {}
    const t = page.render({ canvasContext: ctx, viewport: vp });
    w._task = t;
    await t.promise;
  } catch (e) {
    if (!e || e.name !== 'RenderingCancelledException') console.warn(e);
  }
}
function renderStage() {
  const st = $('#stage');
  const old = new Map($$('.pgw', st).map((w) => [w.dataset.id, w]));
  const frag = document.createDocumentFragment();
  S.pages.forEach((p, i) => {
    let w = old.get(p.id);
    const key = `${p.src}|${p.rot}|${S.zoom}`;
    if (!w || w._key !== key) {
      if (w) {
        io.unobserve(w.querySelector('.pg'));
        if (w._task)
          try {
            w._task.cancel();
          } catch {}
      }
      w = buildPageWrap(p);
      w._key = key;
    }
    w.querySelector('.lab').textContent = `${i + 1} / ${S.pages.length}`;
    frag.appendChild(w);
  });
  st.replaceChildren(frag);
  S.pages.forEach(renderOverlay);
  renderThumbs();
  renderSide();
  drawTextLayers();
  $('#zoomLab') && ($('#zoomLab').textContent = Math.round(S.zoom * 100) + '%');
}

const BOXY = new Set(['text', 'image', 'rect', 'ellipse', 'whiteout', 'redact', 'markup']);
function bbox(e) {
  switch (e.type) {
    case 'line':
    case 'arrow': {
      const x = Math.min(e.x1, e.x2),
        y = Math.min(e.y1, e.y2);
      return { x, y, w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
    }
    case 'draw': {
      const xs = e.pts.map((p) => p[0]),
        ys = e.pts.map((p) => p[1]);
      const x = Math.min(...xs),
        y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case 'note':
      return { x: e.x, y: e.y, w: 22 / S.zoom, h: 22 / S.zoom };
    default:
      return { x: e.x, y: e.y, w: e.w, h: e.h };
  }
}
function moveEl(e, o, dx, dy) {
  if (BOXY.has(e.type) || e.type === 'note') {
    e.x = o.x + dx;
    e.y = o.y + dy;
  } else if (e.type === 'line' || e.type === 'arrow') {
    e.x1 = o.x1 + dx;
    e.y1 = o.y1 + dy;
    e.x2 = o.x2 + dx;
    e.y2 = o.y2 + dy;
  } else if (e.type === 'draw') e.pts = o.pts.map((p) => [p[0] + dx, p[1] + dy]);
}
const svgWrap = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
function elNode(p, e) {
  const z = S.zoom,
    b = bbox(e);
  const n = el('div', {
    class: 'el el-' + e.type + (S.sel === e.id ? ' sel' : ''),
    'data-id': e.id,
  });
  const pad =
    e.type === 'line' || e.type === 'arrow' || e.type === 'draw' ? Math.max(6, (e.sw || 2) * 2) : 0;
  n.style.cssText = `left:${b.x * z - pad}px;top:${b.y * z - pad}px;width:${Math.max(b.w * z, 1) + pad * 2}px;height:${Math.max(b.h * z, 1) + pad * 2}px`;
  const W = Math.max(b.w * z, 1),
    H = Math.max(b.h * z, 1),
    sw = (e.sw || 0) * z;
  if (e.type === 'text') {
    n.style.height = 'auto';
    n.style.minHeight = b.h * z + 'px';
    const t = el('div', { class: 'txt' });
    t.textContent = e.text;
    ensurePreviewFont(e.font);
    Object.assign(t.style, {
      fontSize: e.size * z + 'px',
      fontFamily: cssFont(e.font),
      fontWeight: e.bold ? '700' : '400',
      fontStyle: e.italic ? 'italic' : 'normal',
      textDecoration:
        [e.under && 'underline', e.strike && 'line-through'].filter(Boolean).join(' ') || 'none',
      letterSpacing: (e.ls || 0) * z + 'px',
      color: e.color,
      textAlign: e.align || 'left',
    });
    n.append(t);
  } else if (e.type === 'image') {
    n.append(el('img', { src: S.imgs[e.img]?.url || '', alt: '' }));
    n.style.opacity = e.op ?? 1;
  } else if (e.type === 'rect' || e.type === 'whiteout' || e.type === 'redact') {
    n.innerHTML = svgWrap(
      W,
      H,
      `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(W - sw, 0)}" height="${Math.max(H - sw, 0)}" fill="${e.fill || 'none'}" stroke="${e.stroke || 'none'}" stroke-width="${sw}" opacity="${e.op ?? 1}"/>`,
    );
  } else if (e.type === 'ellipse') {
    n.innerHTML = svgWrap(
      W,
      H,
      `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${Math.max(W / 2 - sw / 2, 0)}" ry="${Math.max(H / 2 - sw / 2, 0)}" fill="${e.fill || 'none'}" stroke="${e.stroke || 'none'}" stroke-width="${sw}" opacity="${e.op ?? 1}"/>`,
    );
  } else if (e.type === 'markup') {
    const c = e.color,
      o = e.op ?? 0.4;
    let inner = '';
    if (e.kind === 'highlight')
      inner = `<rect width="${W}" height="${H}" fill="${c}" opacity="${o}" style="mix-blend-mode:multiply"/>`;
    else {
      const yy = e.kind === 'underline' ? H - 1 : H / 2;
      inner = `<line x1="0" y1="${yy}" x2="${W}" y2="${yy}" stroke="${c}" stroke-width="${Math.max(1.5, H * 0.08)}"/>`;
    }
    n.innerHTML = svgWrap(W, H, inner);
  } else if (e.type === 'line' || e.type === 'arrow') {
    const x1 = (e.x1 - b.x) * z + pad,
      y1 = (e.y1 - b.y) * z + pad,
      x2 = (e.x2 - b.x) * z + pad,
      y2 = (e.y2 - b.y) * z + pad;
    let extra = '';
    if (e.type === 'arrow') {
      const a = Math.atan2(y2 - y1, x2 - x1),
        L = Math.max(10, e.sw * 5) * 1,
        s = 0.45;
      extra = `<polygon points="${x2},${y2} ${x2 - L * Math.cos(a - s)},${y2 - L * Math.sin(a - s)} ${x2 - L * Math.cos(a + s)},${y2 - L * Math.sin(a + s)}" fill="${e.stroke}"/>`;
    }
    n.innerHTML = svgWrap(
      W + pad * 2,
      H + pad * 2,
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${e.stroke}" stroke-width="${e.sw * z}" stroke-linecap="round" opacity="${e.op ?? 1}"/>${extra}<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="${Math.max(12, e.sw * z + 8)}"/>`,
    );
  } else if (e.type === 'draw') {
    const d = e.pts
      .map(
        (q, i) =>
          (i ? 'L' : 'M') +
          ((q[0] - b.x) * z + pad).toFixed(1) +
          ' ' +
          ((q[1] - b.y) * z + pad).toFixed(1),
      )
      .join(' ');
    n.innerHTML = svgWrap(
      W + pad * 2,
      H + pad * 2,
      `<path d="${d}" fill="none" stroke="${e.stroke}" stroke-width="${e.sw * z}" stroke-linecap="round" stroke-linejoin="round" opacity="${e.op ?? 1}"/><path d="${d}" fill="none" stroke="transparent" stroke-width="${Math.max(12, e.sw * z + 8)}"/>`,
    );
  } else if (e.type === 'note') {
    n.title = e.text || 'Comment';
    n.append(el('span', { class: 'ni', text: '✎' }));
    if (e.text) n.append(el('div', { class: 'nt', text: e.text }));
  }
  if (S.sel === e.id) {
    if (BOXY.has(e.type)) {
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((hn) =>
        n.append(el('div', { class: 'h', 'data-h': hn })),
      );
    } else if (e.type === 'line' || e.type === 'arrow') {
      [
        ['p1', e.x1, e.y1],
        ['p2', e.x2, e.y2],
      ].forEach(([k, x, y]) =>
        n.append(
          el('div', {
            class: 'h pt',
            'data-h': k,
            style: `left:${(x - b.x) * z + pad - 6}px;top:${(y - b.y) * z + pad - 6}px`,
          }),
        ),
      );
    }
  }
  return n;
}
function renderOverlay(p) {
  const ov = document.querySelector(`.pgw[data-id="${p.id}"] .ov`);
  if (!ov) return;
  ov.replaceChildren(...p.els.map((e) => elNode(p, e)));
}
function select(id) {
  S.sel = id;
  S.pages.forEach(renderOverlay);
  renderSide();
}
function deselect() {
  if (S.sel) {
    S.sel = null;
    S.pages.forEach(renderOverlay);
    renderSide();
  }
}
const toPt = (ev, ov) => {
  const r = ov.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / S.zoom, y: (ev.clientY - r.top) / S.zoom };
};
const MIN = 6;
function newEl(type, extra) {
  return { id: uid(), type, ...extra };
}
function styleDefaults(type) {
  const d = S.def;
  switch (type) {
    case 'rect':
    case 'ellipse':
      return { stroke: d.stroke, fill: null, sw: d.sw, op: 1 };
    case 'whiteout':
      return { fill: '#ffffff', stroke: null, sw: 0, op: 1 };
    case 'redact':
      return { fill: '#000000', stroke: null, sw: 0, op: 1 };
    case 'line':
    case 'arrow':
    case 'draw':
      return { stroke: d.stroke, sw: d.sw, op: 1 };
    default:
      return {};
  }
}
const DRAGTOOLS = new Set([
  'rect',
  'ellipse',
  'line',
  'arrow',
  'whiteout',
  'redact',
  'highlight',
  'underline',
  'strike',
]);
const DEFSIZE = {
  rect: [140, 90],
  ellipse: [140, 90],
  whiteout: [120, 24],
  redact: [120, 24],
  highlight: [120, 16],
  underline: [120, 16],
  strike: [120, 16],
};

$('#stage').addEventListener('pointerdown', (ev) => {
  const ov = ev.target.closest('.ov');
  if (!ov) {
    if (!ev.target.closest('.pgw') && !ev.target.closest('.h')) deselect();
    return;
  }
  const w = ov.closest('.pgw'),
    p = pageById(w.dataset.id);
  if (!p) return;
  const pt = toPt(ev, ov);
  const hn = ev.target.closest('.h'),
    en = ev.target.closest('.el');
  if (S.editing && !(en && en.dataset.id === S.editing)) {
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
  }
  if (S.editing && en && en.dataset.id === S.editing) return;
  if (hn && en) {
    startResize(ev, p, ov, en.dataset.id, hn.dataset.h);
    return;
  }
  if (S.tool === 'edittext') return;
  if (S.place) {
    placeImage(p, pt);
    return;
  }
  const hit = en ? p.els.find((x) => x.id === en.dataset.id) : null;
  if (hit && (S.tool === 'select' || (S.tool === 'text' && hit.type === 'text'))) {
    if (S.editing === hit.id) return;
    select(hit.id);
    startMove(ev, p, ov, hit);
    return;
  }
  if (S.tool === 'select') {
    deselect();
    return;
  }
  const tool = S.tool;
  if (tool === 'text') {
    pushUndo();
    const e = newEl('text', {
      x: pt.x,
      y: pt.y,
      w: Math.min(320, pw(p) - pt.x - 12),
      h: S.def.size * 1.2,
      text: '',
      font: S.def.font,
      size: S.def.size,
      color: S.def.color,
      bold: S.def.bold,
      italic: S.def.italic,
      under: S.def.under,
      strike: S.def.strike,
      ls: S.def.ls,
      align: S.def.align,
    });
    p.els.push(e);
    S.sel = e.id;
    renderOverlay(p);
    renderSide();
    setTimeout(() => startEdit(e.id), 30);
    S.tool = 'select';
    $('#stage').dataset.tool = 'select';
    updBar();
    return;
  }
  if (tool === 'note') {
    pushUndo();
    const e = newEl('note', { x: pt.x, y: pt.y, text: '' });
    p.els.push(e);
    S.sel = e.id;
    S.tool = 'select';
    $('#stage').dataset.tool = 'select';
    updBar();
    renderOverlay(p);
    renderSide();
    setTimeout(() => $('#noteText')?.focus(), 30);
    return;
  }
  if (tool === 'draw') {
    pushUndo();
    const e = newEl('draw', { pts: [[pt.x, pt.y]], ...styleDefaults('draw') });
    p.els.push(e);
    ov.setPointerCapture(ev.pointerId);
    const mv = (m) => {
      const q = toPt(m, ov);
      const l = e.pts[e.pts.length - 1];
      if (Math.hypot(q.x - l[0], q.y - l[1]) > 0.8) {
        e.pts.push([q.x, q.y]);
        renderOverlay(p);
      }
    };
    const up = () => {
      ov.removeEventListener('pointermove', mv);
      ov.removeEventListener('pointerup', up);
      if (e.pts.length < 2) e.pts.push([e.pts[0][0] + 0.1, e.pts[0][1]]);
      S.sel = e.id;
      renderOverlay(p);
      renderSide();
    };
    ov.addEventListener('pointermove', mv);
    ov.addEventListener('pointerup', up);
    return;
  }
  if (DRAGTOOLS.has(tool)) {
    pushUndo();
    const isMk = ['highlight', 'underline', 'strike'].includes(tool);
    const e = isMk
      ? newEl('markup', {
          kind: tool === 'strike' ? 'strike' : tool,
          x: pt.x,
          y: pt.y,
          w: 0,
          h: 0,
          color: tool === 'highlight' ? S.def.hl : S.def.stroke,
          op: tool === 'highlight' ? 0.4 : 1,
        })
      : tool === 'line' || tool === 'arrow'
        ? newEl(tool, { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, ...styleDefaults(tool) })
        : newEl(tool, { x: pt.x, y: pt.y, w: 0, h: 0, ...styleDefaults(tool) });
    p.els.push(e);
    ov.setPointerCapture(ev.pointerId);
    let moved = false;
    const sx = pt.x,
      sy = pt.y;
    const mv = (m) => {
      const q = toPt(m, ov);
      moved = true;
      if (e.type === 'line' || e.type === 'arrow') {
        e.x2 = q.x;
        e.y2 = q.y;
        if (m.shiftKey) e.y2 = e.y1;
      } else {
        e.x = Math.min(sx, q.x);
        e.y = Math.min(sy, q.y);
        e.w = Math.abs(q.x - sx);
        e.h = Math.abs(q.y - sy);
      }
      renderOverlay(p);
    };
    const up = () => {
      ov.removeEventListener('pointermove', mv);
      ov.removeEventListener('pointerup', up);
      if (e.type === 'line' || e.type === 'arrow') {
        if (Math.hypot(e.x2 - e.x1, e.y2 - e.y1) < MIN) {
          e.x2 = e.x1 + 100;
          e.y2 = e.y1;
        }
      } else if (e.w < MIN || e.h < MIN) {
        const [dw, dh] = DEFSIZE[tool] || [100, 40];
        e.w = dw;
        e.h = dh;
        if (tool !== 'whiteout') e.x = sx;
      }
      S.sel = e.id;
      if (!isMk && tool !== 'draw') {
        S.tool = 'select';
        $('#stage').dataset.tool = 'select';
      }
      renderOverlay(p);
      renderSide();
      updBar();
    };
    ov.addEventListener('pointermove', mv);
    ov.addEventListener('pointerup', up);
  }
});

function startMove(ev, p, ov, e) {
  const s = toPt(ev, ov),
    orig = JSON.parse(JSON.stringify(e));
  let pushed = false;
  ov.setPointerCapture(ev.pointerId);
  const mv = (m) => {
    const q = toPt(m, ov);
    const dx = q.x - s.x,
      dy = q.y - s.y;
    if (!pushed && Math.hypot(dx, dy) * S.zoom < 3) return;
    if (!pushed) {
      pushed = true;
      S.undo.push(
        JSON.stringify(
          S.pages.map((pg) =>
            pg.id === p.id ? { ...pg, els: pg.els.map((x) => (x.id === e.id ? orig : x)) } : pg,
          ),
        ),
      );
      S.redo = [];
      S.dirty = true;
      updBar();
    }
    moveEl(e, orig, dx, dy);
    renderOverlay(p);
  };
  const up = () => {
    ov.removeEventListener('pointermove', mv);
    ov.removeEventListener('pointerup', up);
  };
  ov.addEventListener('pointermove', mv);
  ov.addEventListener('pointerup', up);
}
function startResize(ev, p, ov, id, hn) {
  const e = p.els.find((x) => x.id === id);
  if (!e) return;
  ev.preventDefault();
  pushUndo();
  ov.setPointerCapture(ev.pointerId);
  const o = JSON.parse(JSON.stringify(e));
  const b = bbox(o);
  const ar = b.w / (b.h || 1);
  const mv = (m) => {
    const q = toPt(m, ov);
    if (hn === 'p1') {
      e.x1 = q.x;
      e.y1 = q.y;
    } else if (hn === 'p2') {
      e.x2 = q.x;
      e.y2 = q.y;
    } else {
      let x = b.x,
        y = b.y,
        r = b.x + b.w,
        bt = b.y + b.h;
      if (hn.includes('w')) x = Math.min(q.x, r - MIN);
      if (hn.includes('e')) r = Math.max(q.x, x + MIN);
      if (hn.includes('n')) y = Math.min(q.y, bt - MIN);
      if (hn.includes('s')) bt = Math.max(q.y, y + MIN);
      let w = r - x,
        h = bt - y;
      if (e.type === 'image' && hn.length === 2) {
        h = w / ar;
        if (hn.includes('n')) y = bt - h;
      }
      e.x = x;
      e.y = y;
      e.w = w;
      e.h = h;
    }
    renderOverlay(p);
  };
  const up = () => {
    ov.removeEventListener('pointermove', mv);
    ov.removeEventListener('pointerup', up);
    renderSide();
  };
  ov.addEventListener('pointermove', mv);
  ov.addEventListener('pointerup', up);
}

function startEdit(id) {
  const f = findEl(id);
  if (!f) return;
  const node = document.querySelector(`.el[data-id="${id}"] .txt`);
  if (!node) return;
  S.editing = id;
  node.classList.add('editing');
  try {
    node.contentEditable = 'plaintext-only';
  } catch {}
  if (node.contentEditable !== 'plaintext-only') node.contentEditable = 'true';
  node.focus();
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
  const e = f.el,
    p = f.p;
  const grow = () => {
    const h = node.parentElement.scrollHeight / S.zoom;
    e.h = Math.max(S.def.size, h);
  };
  node.oninput = () => {
    e.text = node.innerText.replace(/\n$/, '');
    grow();
  };
  node.onblur = (ev) => {
    node.oninput();
    node.contentEditable = 'false';
    node.classList.remove('editing');
    S.editing = null;
    if (!e.text.trim()) {
      p.els = p.els.filter((x) => x !== e);
      if (S.sel === e.id) S.sel = null;
    }
    renderOverlay(p);
    const to = ev && ev.relatedTarget;
    if (!(to && to.closest && to.closest('#side') && e.text.trim())) renderSide();
  };
}
$('#stage').addEventListener('dblclick', (ev) => {
  const en = ev.target.closest('.el-text');
  if (en && S.tool !== 'edittext') {
    const f = findEl(en.dataset.id);
    if (f) {
      pushUndo();
      select(f.el.id);
      startEdit(f.el.id);
    }
  }
});

const tiCache = new Map();
const FONT_ALIAS = {
  timesnewroman: 'Times New Roman',
  times: 'Times New Roman',
  liberationserif: 'Times New Roman',
  tinos: 'Times New Roman',
  arial: 'Arial',
  helvetica: 'Arial',
  liberationsans: 'Arial',
  arimo: 'Arial',
  couriernew: 'Courier New',
  courier: 'Courier New',
  liberationmono: 'Courier New',
  cousine: 'Courier New',
  calibri: 'Calibri',
  carlito: 'Calibri',
  cambria: 'Cambria',
  caladea: 'Cambria',
  georgia: 'Georgia',
  gelasio: 'Georgia',
  consolas: 'Consolas',
  comicsansms: 'Comic Sans MS',
  impact: 'Impact',
};
const normFont = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
const WEB_NORM = Object.keys(WEB)
  .map((n) => [normFont(n), n])
  .sort((a, b) => b[0].length - a[0].length);
function matchFont(raw, fam, fo) {
  const name = String(raw || '').replace(/^[A-Z]{6}\+/, '');
  const base = name.split(/[-,]/)[0];
  const key = normFont(base).replace(/(psmt|mt|ps)$/, '');
  const full = name.toLowerCase();
  const bold = !!(fo && fo.bold) || /bold|black|heavy|semibold|demi/.test(full);
  const italic = !!(fo && fo.italic) || /italic|oblique/.test(full);
  let font = FONT_ALIAS[key] || null;
  if (!font) {
    const hit =
      WEB_NORM.find(([n]) => key === n) ||
      WEB_NORM.find(([n]) => n.length > 3 && key.startsWith(n));
    if (hit) font = hit[1];
  }
  if (!font) {
    const mono = (fo && fo.isMonospace) || /mono|courier/i.test(fam);
    const serif = (fo && fo.isSerifFont) || (/serif/i.test(fam) && !/sans/i.test(fam));
    font = mono ? 'Courier' : serif ? 'Times' : 'Helvetica';
  }
  return { font, bold, italic };
}
async function textItems(p) {
  const key = `${p.src}|${p.rot}`;
  if (tiCache.has(key)) return tiCache.get(key);
  const page = await S.doc.getPage(p.src + 1);
  const vp = page.getViewport({ scale: 1, rotation: (p.nat + p.rot) % 360 });
  const tc = await page.getTextContent();
  try {
    await page.getOperatorList();
  } catch {}
  const out = tc.items
    .filter((t) => t.str && t.str.trim())
    .map((t) => {
      const tx = pdfjsLib.Util.transform(vp.transform, t.transform);
      const size = Math.hypot(tx[2], tx[3]);
      const fam = tc.styles[t.fontName]?.fontFamily || '';
      let fo = null;
      try {
        fo = page.commonObjs.get(t.fontName);
      } catch {}
      const m = matchFont(fo && fo.name, fam, fo);
      return {
        s: t.str,
        x: tx[4],
        base: tx[5],
        w: t.width,
        size,
        horiz: Math.abs(tx[1]) < 0.01 && Math.abs(tx[2]) < 0.01,
        font: m.font,
        bold: m.bold,
        italic: m.italic,
      };
    })
    .filter((t) => t.horiz);
  tiCache.set(key, out);
  return out;
}
async function drawTextLayers() {
  $$('.pgw .tl').forEach((t) => t.replaceChildren());
  if (S.tool !== 'edittext') return;
  for (const p of S.pages) {
    if (p.src < 0) continue;
    const tl = document.querySelector(`.pgw[data-id="${p.id}"] .tl`);
    if (!tl) continue;
    const items = await textItems(p);
    if (S.tool !== 'edittext') return;
    tl.style.pointerEvents = 'auto';
    items.forEach((it) => {
      const d = el('div', {
        class: 'ti',
        style: `left:${it.x * S.zoom}px;top:${(it.base - it.size * 0.9) * S.zoom}px;width:${it.w * S.zoom}px;height:${it.size * 1.15 * S.zoom}px`,
      });
      d.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        replaceText(p, it);
      });
      tl.append(d);
    });
  }
}
function replaceText(p, it) {
  pushUndo();
  p.els.push(
    newEl('whiteout', {
      x: it.x - 1,
      y: it.base - it.size * 0.92,
      w: it.w + 2,
      h: it.size * 1.2,
      fill: '#ffffff',
      stroke: null,
      sw: 0,
      op: 1,
    }),
  );
  const e = newEl('text', {
    x: it.x,
    y: it.base - it.size * 0.95,
    w: Math.max(it.w + 12, pw(p) - it.x - 20),
    h: it.size * 1.2,
    text: it.s,
    font: it.font,
    size: Math.round(it.size * 10) / 10,
    color: '#000000',
    bold: it.bold,
    italic: it.italic,
    under: false,
    strike: false,
    ls: 0,
    align: 'left',
  });
  p.els.push(e);
  S.tool = 'select';
  $('#stage').dataset.tool = 'select';
  $$('.pgw .tl').forEach((t) => t.replaceChildren());
  S.sel = e.id;
  renderOverlay(p);
  renderSide();
  updBar();
  setTimeout(() => startEdit(e.id), 0);
}

const IMGLOAD = (file) =>
  new Promise(async (res, rej) => {
    try {
      let blob = file,
        mime = file.type;
      if (mime !== 'image/png' && mime !== 'image/jpeg') {
        const bmp = await createImageBitmap(file);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        blob = await canvasBlob(c, 'image/png');
        mime = 'image/png';
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const im = new Image();
      im.onload = () => {
        const id = uid();
        S.imgs[id] = { mime, bytes, url, w: im.naturalWidth, h: im.naturalHeight };
        res(id);
      };
      im.onerror = () => rej(new Error('Could not read that image.'));
      im.src = url;
    } catch (e) {
      rej(e);
    }
  });
function pickImage() {
  const i = el('input', { type: 'file', accept: 'image/*' });
  i.onchange = () => {
    if (i.files[0]) importImage(i.files[0]);
  };
  i.click();
}
async function importImage(file) {
  try {
    const id = await IMGLOAD(file);
    S.place = { img: id };
    S.tool = 'place';
    $('#stage').dataset.tool = 'place';
    updBar();
    toast('Click on the page where the image should go.');
  } catch (e) {
    toast(e.message);
  }
}
function placeImage(p, pt) {
  const im = S.imgs[S.place.img];
  const w = Math.min(240, im.w),
    h = (w * im.h) / im.w;
  pushUndo();
  const e = newEl('image', {
    x: clamp(pt.x - w / 2, 0, pw(p) - w),
    y: clamp(pt.y - h / 2, 0, ph(p) - h),
    w,
    h,
    img: S.place.img,
    op: 1,
  });
  p.els.push(e);
  S.place = null;
  S.tool = 'select';
  $('#stage').dataset.tool = 'select';
  S.sel = e.id;
  renderOverlay(p);
  renderSide();
  updBar();
}
function visiblePage() {
  const r = $('#stage').getBoundingClientRect();
  let best = S.pages[0],
    bd = 1e9;
  for (const p of S.pages) {
    const n = document.querySelector(`.pgw[data-id="${p.id}"] .pg`);
    if (!n) continue;
    const b = n.getBoundingClientRect();
    const d = Math.abs((b.top + b.bottom) / 2 - (r.top + r.bottom) / 2);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
function openSign() {
  const root = $('#modalRoot');
  let mode = 'draw',
    color = '#101010';
  const cv = el('canvas', {
    class: 'sigpad',
    width: 900,
    height: 300,
    style: 'height:auto;aspect-ratio:3/1',
  });
  const ctx = cv.getContext('2d');
  let drawing = false,
    dirty = false;
  const typed = el('input', {
    type: 'text',
    id: 'sigText',
    placeholder: 'Type your name',
    hidden: true,
  });
  const up = el('input', { type: 'file', accept: 'image/*', hidden: true, id: 'sigFile' });
  const setMode = (m) => {
    mode = m;
    cv.hidden = m !== 'draw';
    typed.hidden = m !== 'type';
    up.hidden = m !== 'upload';
    $$('.sigtab', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
  };
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * cv.width) / r.width,
      ((e.clientY - r.top) * cv.height) / r.height,
    ];
  };
  cv.onpointerdown = (e) => {
    drawing = true;
    dirty = true;
    cv.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  cv.onpointermove = (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  cv.onpointerup = () => (drawing = false);
  const close = () => root.replaceChildren();
  const apply = async () => {
    let blob;
    if (mode === 'draw') {
      if (!dirty) {
        toast('Draw your signature first.');
        return;
      }
      blob = await canvasBlob(trim(cv), 'image/png');
    } else if (mode === 'type') {
      const t = typed.value.trim();
      if (!t) {
        toast('Type your name first.');
        return;
      }
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 360;
      const x = c.getContext('2d');
      x.fillStyle = color;
      x.font = '200px Caveat, "Segoe Script", cursive';
      x.textBaseline = 'middle';
      x.fillText(t, 20, 190, 1160);
      blob = await canvasBlob(trim(c), 'image/png');
    } else {
      if (!up.files[0]) {
        toast('Choose an image first.');
        return;
      }
      blob = up.files[0];
    }
    close();
    await importImage(new File([blob], 'signature.png', { type: blob.type || 'image/png' }));
  };
  function trim(c) {
    const x = c.getContext('2d'),
      d = x.getImageData(0, 0, c.width, c.height).data;
    let a = c.width,
      b = c.height,
      r = 0,
      t = 0;
    for (let y = 0; y < c.height; y++)
      for (let xx = 0; xx < c.width; xx++)
        if (d[(y * c.width + xx) * 4 + 3] > 8) {
          if (xx < a) a = xx;
          if (xx > r) r = xx;
          if (y < b) b = y;
          if (y > t) t = y;
        }
    if (r < a) return c;
    const o = document.createElement('canvas');
    o.width = r - a + 20;
    o.height = t - b + 20;
    o.getContext('2d').drawImage(c, a - 10, b - 10, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  }
  root.replaceChildren(
    el(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add signature' },
      el(
        'div',
        null,
        el('h3', { text: 'Add signature' }),
        el(
          'div',
          { class: 'row' },
          ...[
            ['draw', 'Draw'],
            ['type', 'Type'],
            ['upload', 'Upload'],
          ].map(([m, l]) =>
            el('button', {
              class: 'tb sigtab',
              'data-m': m,
              'aria-pressed': String(m === 'draw'),
              text: l,
              onclick: () => setMode(m),
            }),
          ),
          el('span', { style: 'flex:1' }),
          ...['#101010', '#1f3fbf', '#b3261e'].map((c) =>
            el('button', {
              class: 'icon-btn',
              'aria-label': 'Ink ' + c,
              style: `background:${c};width:28px`,
              onclick: () => {
                color = c;
              },
            }),
          ),
        ),
        cv,
        typed,
        up,
        el(
          'div',
          { class: 'row' },
          el('button', { class: 'btn', text: 'Add to page', onclick: apply }),
          el('button', {
            class: 'btn alt',
            text: 'Clear',
            onclick: () => {
              ctx.clearRect(0, 0, cv.width, cv.height);
              dirty = false;
              typed.value = '';
            },
          }),
          el('button', { class: 'btn alt', text: 'Cancel', onclick: close }),
        ),
      ),
    ),
  );
}

document.addEventListener('keydown', (ev) => {
  if ($('#editorView').hidden) return;
  const tg = ev.target;
  if (tg.matches('input,textarea,select') || tg.isContentEditable) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    ev.shiftKey ? doRedo() : doUndo();
    return;
  }
  if (mod && ev.key.toLowerCase() === 'y') {
    ev.preventDefault();
    doRedo();
    return;
  }
  if (ev.key === 'Escape') {
    S.place = null;
    setTool('select');
    return;
  }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && S.sel) {
    ev.preventDefault();
    deleteSel();
    return;
  }
  if (S.sel && ev.key.startsWith('Arrow')) {
    const f = findEl(S.sel);
    if (!f) return;
    ev.preventDefault();
    pushUndo();
    const d = ev.shiftKey ? 10 : 1;
    const o = JSON.parse(JSON.stringify(f.el));
    moveEl(
      f.el,
      o,
      ev.key === 'ArrowRight' ? d : ev.key === 'ArrowLeft' ? -d : 0,
      ev.key === 'ArrowDown' ? d : ev.key === 'ArrowUp' ? -d : 0,
    );
    renderOverlay(f.p);
    return;
  }
  if (!mod) {
    const k = {
      v: 'select',
      t: 'text',
      d: 'draw',
      h: 'highlight',
      r: 'rect',
      o: 'ellipse',
      l: 'line',
      a: 'arrow',
      n: 'note',
    }[ev.key.toLowerCase()];
    if (k) setTool(k);
  }
});
function deleteSel() {
  const f = findEl(S.sel);
  if (!f) return;
  pushUndo();
  f.p.els = f.p.els.filter((x) => x !== f.el);
  S.sel = null;
  renderOverlay(f.p);
  renderSide();
}

const TYPELABEL = {
  text: 'Text',
  image: 'Image',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  whiteout: 'Whiteout',
  redact: 'Redact',
  markup: 'Markup',
  line: 'Line',
  arrow: 'Arrow',
  draw: 'Drawing',
  note: 'Comment',
};
const colorField = (label, val, on, allowNone) => {
  const wrap = el('div', { class: 'field' }, el('label', { text: label }));
  const row = el('div', { class: 'inl' });
  const c = el('input', {
    type: 'color',
    value: val && val !== 'none' ? val : '#ffffff',
    'aria-label': label,
  });
  c.oninput = () => on(c.value);
  row.append(c);
  if (allowNone) {
    const cb = el('input', {
      type: 'checkbox',
      checked: !val,
      id: 'none-' + label.replace(/\W/g, ''),
    });
    const l = el('label', {
      for: cb.id,
      text: 'None',
      style:
        'font-family:var(--sans);text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink)',
    });
    cb.onchange = () => on(cb.checked ? null : c.value);
    row.append(cb, l);
  }
  wrap.append(row);
  return wrap;
};
const numField = (label, val, min, max, step, on, list) => {
  const i = el('input', { type: 'number', value: val, min, max, step, list });
  i.oninput = () => {
    const v = +i.value;
    if (!isNaN(v)) on(clamp(v, min, max));
  };
  return el('div', { class: 'field' }, el('label', { text: label }), i);
};
function renderSide() {
  const side = $('#side');
  if (!side || $('#edApp').hidden) return;
  const f = S.sel && findEl(S.sel);
  side.replaceChildren();
  const commit = (fn, def) => {
    if (!f) return;
    fn(f.el);
    if (def) def();
    renderOverlay(f.p);
  };
  let lastPush = 0;
  const withUndo = (fn) => (v) => {
    const now = Date.now();
    if (now - lastPush > 800) {
      pushUndo();
    }
    lastPush = now;
    fn(v);
  };
  const props = el('div', null, el('div', { class: 'sec-h', text: 'Properties' }));
  if (!f) {
    props.append(
      el('div', {
        class: 'muted',
        style: 'font-size:13px',
        text:
          S.tool === 'select'
            ? 'Select an element to change it, or pick a tool from the bar above.'
            : 'Click or drag on the page to add it. Press Esc to go back to Select.',
      }),
    );
  } else {
    const e = f.el,
      pf = el('div', { class: 'pf' });
    props.append(
      el('div', {
        style: 'font-weight:500;margin-bottom:10px',
        text: TYPELABEL[e.type] + (e.type === 'markup' ? ' · ' + e.kind : ''),
      }),
      pf,
    );
    const set = (k, defk) =>
      withUndo((v) => {
        e[k] = v;
        if (defk) S.def[defk] = v;
        renderOverlay(f.p);
      });
    if (e.type === 'text') {
      const fs = el('select');
      const kinds = [
        ['sans', 'Sans serif', 'Helvetica'],
        ['serif', 'Serif', 'Times'],
        ['mono', 'Monospace', 'Courier'],
        ['script', 'Handwriting'],
        ['display', 'Display'],
      ];
      kinds.forEach(([kind, label, std]) => {
        const items = WEBFONTS.filter((x) => x.kind === kind).map((x) => [
          x.name,
          x.like ? x.name + ' · ' + x.like : x.name,
        ]);
        if (std) items.unshift([std, std]);
        fs.append(
          el(
            'optgroup',
            { label },
            items.map(([v, t]) => el('option', { value: v, text: t, selected: v === e.font })),
          ),
        );
      });
      fs.onchange = () =>
        withUndo((v) => {
          e.font = v;
          S.def.font = v;
          ensurePreviewFont(v);
          renderOverlay(f.p);
        })(fs.value);
      pf.append(
        el('div', { class: 'field full' }, el('label', { text: 'Font' }), fs),
        numField('Size', e.size, 6, 200, 1, set('size', 'size'), 'pw-sizes'),
        numField('Letter spacing', e.ls || 0, -5, 40, 0.5, set('ls', 'ls')),
        el(
          'div',
          { class: 'inl full' },
          el('button', {
            class: 'icon-btn',
            'aria-pressed': String(!!e.bold),
            text: 'B',
            style: 'font-weight:700',
            onclick: () => {
              pushUndo();
              e.bold = !e.bold;
              S.def.bold = e.bold;
              renderOverlay(f.p);
              renderSide();
            },
          }),
          el('button', {
            class: 'icon-btn',
            'aria-pressed': String(!!e.italic),
            text: 'I',
            style: 'font-style:italic;font-family:Georgia,serif',
            onclick: () => {
              pushUndo();
              e.italic = !e.italic;
              S.def.italic = e.italic;
              renderOverlay(f.p);
              renderSide();
            },
          }),
          el('button', {
            class: 'icon-btn',
            'aria-pressed': String(!!e.under),
            'aria-label': 'Underline',
            title: 'Underline',
            text: 'U',
            style: 'text-decoration:underline',
            onclick: () => {
              pushUndo();
              e.under = !e.under;
              S.def.under = e.under;
              renderOverlay(f.p);
              renderSide();
            },
          }),
          el('button', {
            class: 'icon-btn',
            'aria-pressed': String(!!e.strike),
            'aria-label': 'Strikethrough',
            title: 'Strikethrough',
            text: 'S',
            style: 'text-decoration:line-through',
            onclick: () => {
              pushUndo();
              e.strike = !e.strike;
              S.def.strike = e.strike;
              renderOverlay(f.p);
              renderSide();
            },
          }),
        ),
        el(
          'div',
          { class: 'inl full' },
          ...['left', 'center', 'right'].map((a) =>
            el('button', {
              class: 'icon-btn',
              'aria-label': 'Align ' + a,
              text: { left: '◧', center: '◫', right: '◨' }[a],
              'aria-pressed': String(e.align === a),
              onclick: () => {
                pushUndo();
                e.align = a;
                S.def.align = a;
                renderOverlay(f.p);
                renderSide();
              },
            }),
          ),
        ),
      );
      pf.append(
        Object.assign(colorField('Color', e.color, set('color', 'color')), {
          className: 'field full',
        }),
      );
    } else if (e.type === 'image') {
      pf.append(
        numField('Opacity %', Math.round((e.op ?? 1) * 100), 5, 100, 5, (v) => set('op')(v / 100)),
      );
    } else if (
      e.type === 'rect' ||
      e.type === 'ellipse' ||
      e.type === 'whiteout' ||
      e.type === 'redact'
    ) {
      pf.append(
        colorField(
          'Fill',
          e.fill,
          (v) => set('fill')(v),
          e.type === 'rect' || e.type === 'ellipse',
        ),
        colorField(
          'Border',
          e.stroke,
          (v) => {
            set('stroke', 'stroke')(v);
          },
          true,
        ),
        numField('Border width', e.sw || 0, 0, 40, 1, set('sw', 'sw')),
        numField('Opacity %', Math.round((e.op ?? 1) * 100), 5, 100, 5, (v) => set('op')(v / 100)),
      );
    } else if (e.type === 'markup') {
      pf.append(
        colorField('Color', e.color, set('color', 'hl')),
        numField('Opacity %', Math.round((e.op ?? 1) * 100), 5, 100, 5, (v) => set('op')(v / 100)),
      );
    } else if (e.type === 'line' || e.type === 'arrow' || e.type === 'draw') {
      pf.append(
        colorField('Color', e.stroke, set('stroke', 'stroke')),
        numField('Width', e.sw, 1, 40, 1, set('sw', 'sw')),
        numField('Opacity %', Math.round((e.op ?? 1) * 100), 5, 100, 5, (v) => set('op')(v / 100)),
      );
    } else if (e.type === 'note') {
      const ta = el('textarea', {
        id: 'noteText',
        style: 'min-height:90px;font-family:var(--sans);font-size:14px',
        placeholder: 'Write a comment',
      });
      ta.value = e.text || '';
      ta.oninput = () => {
        e.text = ta.value;
        renderOverlay(f.p);
      };
      ta.onfocus = () => pushUndo();
      pf.append(
        Object.assign(el('div', { class: 'field full' }, el('label', { text: 'Comment' }), ta)),
      );
    }
    props.append(
      el(
        'div',
        { class: 'row', style: 'margin-top:12px' },
        el('button', {
          class: 'btn alt sm',
          text: 'Duplicate',
          onclick: () => {
            pushUndo();
            const c = JSON.parse(JSON.stringify(e));
            c.id = uid();
            moveEl(c, JSON.parse(JSON.stringify(e)), 12, 12);
            f.p.els.push(c);
            S.sel = c.id;
            renderOverlay(f.p);
            renderSide();
          },
        }),
        el('button', { class: 'btn alt sm', text: 'To front', onclick: () => reorder(f, 1) }),
        el('button', { class: 'btn alt sm', text: 'To back', onclick: () => reorder(f, -1) }),
        el('button', { class: 'btn alt sm', text: 'Delete', onclick: deleteSel }),
      ),
    );
  }
  side.append(props);
  const total = S.pages.reduce((a, p) => a + p.els.length, 0);
  const els = el('div', null, el('div', { class: 'sec-h', text: 'Elements' }));
  if (!total)
    els.append(
      el('div', {
        class: 'muted',
        style: 'font-size:13px',
        text: 'Use the toolbar to add text, images and shapes. Reorder items here to move them to the back or front.',
      }),
    );
  else {
    const ul = el('ul', { class: 'els' });
    S.pages.forEach((p, pi) => {
      if (!p.els.length) return;
      ul.append(el('li', { class: 'pgh', text: 'Page ' + (pi + 1) }));
      [...p.els].reverse().forEach((e) => {
        const label =
          TYPELABEL[e.type] +
          (e.type === 'text' || e.type === 'note' ? ' · ' + (e.text || '').slice(0, 22) : '');
        ul.append(
          el(
            'li',
            { class: e.id === S.sel ? 'on' : '' },
            el('button', {
              class: 'nm',
              text: label,
              onclick: () => {
                select(e.id);
                document
                  .querySelector(`.pgw[data-id="${p.id}"]`)
                  ?.scrollIntoView({ block: 'center' });
              },
            }),
            el('button', {
              class: 'icon-btn',
              'aria-label': 'Bring forward',
              text: '↑',
              onclick: () => reorder({ p, el: e }, 1, true),
            }),
            el('button', {
              class: 'icon-btn',
              'aria-label': 'Send backward',
              text: '↓',
              onclick: () => reorder({ p, el: e }, -1, true),
            }),
            el('button', {
              class: 'icon-btn',
              'aria-label': 'Delete',
              text: '✕',
              onclick: () => {
                pushUndo();
                p.els = p.els.filter((x) => x !== e);
                if (S.sel === e.id) S.sel = null;
                renderOverlay(p);
                renderSide();
              },
            }),
          ),
        );
      });
    });
    els.append(ul);
    const rm = el('button', {
      class: 'btn alt sm',
      style: 'margin-top:12px',
      text: 'Remove all',
    });
    rm.onclick = () => {
      if (rm.dataset.armed) {
        pushUndo();
        S.pages.forEach((p) => (p.els = []));
        S.sel = null;
        S.pages.forEach(renderOverlay);
        renderSide();
      } else {
        rm.dataset.armed = '1';
        rm.textContent = 'Click again to remove all ' + total;
        setTimeout(() => {
          rm.dataset.armed = '';
          rm.textContent = 'Remove all';
        }, 3000);
      }
    };
    els.append(rm);
  }
  side.append(els);
  const fm = el('div', { id: 'formSec' }, el('div', { class: 'sec-h', text: 'Form fields' }));
  if (!S.fields.length)
    fm.append(
      el('div', {
        class: 'muted',
        style: 'font-size:13px',
        text: 'This PDF has no fillable fields. Use the Text tool to type onto the page.',
      }),
    );
  else {
    S.fields.forEach((fd) => {
      const id = 'ff-' + fd.name.replace(/\W/g, '_');
      let ctl;
      const v = S.form[fd.name] ?? fd.value;
      if (fd.kind === 'check') {
        ctl = el('input', { type: 'checkbox', id, checked: !!v });
        ctl.onchange = () => {
          S.form[fd.name] = ctl.checked;
          S.dirty = true;
        };
        fm.append(
          el(
            'div',
            { class: 'inl', style: 'margin-bottom:8px' },
            ctl,
            el('label', { for: id, text: fd.name, style: 'font-size:13px' }),
          ),
        );
      } else {
        ctl = fd.options
          ? el('select', { id }, [
              el('option', { value: '', text: '—' }),
              ...fd.options.map((o) => el('option', { value: o, text: o, selected: o === v })),
            ])
          : el('input', { type: 'text', id, value: v || '' });
        ctl.oninput = ctl.onchange = () => {
          S.form[fd.name] = ctl.value;
          S.dirty = true;
        };
        fm.append(
          el(
            'div',
            { class: 'field', style: 'margin-bottom:10px' },
            el('label', { for: id, text: fd.name }),
            ctl,
          ),
        );
      }
    });
    fm.append(
      el('div', {
        class: 'hint muted',
        style: 'font-size:12px',
        text: 'Values are written into the PDF when you download it.',
      }),
    );
  }
  if (S.panelFocus === 'forms') side.prepend(fm);
  else side.append(fm);
  side.append(
    el(
      'div',
      null,
      el('div', { class: 'sec-h', text: 'Document' }),
      el('div', {
        class: 'muted mono',
        style: 'margin-bottom:10px;overflow-wrap:anywhere',
        text: S.name + ' · ' + S.pages.length + ' pages',
      }),
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn alt sm',
          text: 'Add blank page',
          onclick: () => addBlank(S.pages.length - 1),
        }),
        el('button', {
          class: 'btn alt sm',
          text: 'Rotate all',
          onclick: () => {
            pushUndo();
            S.pages.forEach((p) => rotatePage(p, 'cw'));
            renderStage();
          },
        }),
      ),
    ),
  );
  side.append(
    el(
      'div',
      null,
      el('div', { class: 'sec-h', text: 'Convert this PDF' }),
      el(
        'ul',
        { class: 'dots', style: 'font-size:14px' },
        ...[
          'pdf-to-jpg',
          'pdf-to-word',
          'pdf-to-powerpoint',
          'pdf-to-excel',
          'pdf-to-pdfa',
          'compress',
        ].map((id) =>
          el(
            'li',
            null,
            el('a', {
              href: '#' + id,
              'data-keep': '1',
              text: TOOLS.find((t) => t.id === id).name,
              onclick: async (e) => {
                e.preventDefault();
                try {
                  S.carry = { bytes: await buildPdf(), name: S.name };
                } catch (err) {
                  toast('Could not apply your edits: ' + err.message);
                  return;
                }
                skipGuard = true;
                location.hash = id;
              },
            }),
          ),
        ),
      ),
    ),
  );
}
function reorder(f, dir, step) {
  pushUndo();
  const a = f.p.els,
    i = a.indexOf(f.el);
  a.splice(i, 1);
  if (step) a.splice(clamp(i + dir, 0, a.length), 0, f.el);
  else if (dir > 0) a.push(f.el);
  else a.unshift(f.el);
  renderOverlay(f.p);
  renderSide();
}

const thumbCache = new Map();
let thumbQ = Promise.resolve();
function thumbSrc(p, img) {
  const key = `${p.src}|${p.rot}`;
  if (p.src < 0) {
    img.src =
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${pw(p)}" height="${ph(p)}"><rect width="100%" height="100%" fill="#fff"/></svg>`,
      );
    return;
  }
  if (thumbCache.has(key)) {
    img.src = thumbCache.get(key);
    return;
  }
  thumbQ = thumbQ.then(async () => {
    if (thumbCache.has(key)) {
      img.src = thumbCache.get(key);
      return;
    }
    try {
      const page = await S.doc.getPage(p.src + 1);
      const sc = 120 / pw(p);
      const vp = page.getViewport({ scale: sc * 1.5, rotation: (p.nat + p.rot) % 360 });
      const c = document.createElement('canvas');
      c.width = vp.width;
      c.height = vp.height;
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      const u = c.toDataURL('image/jpeg', 0.6);
      thumbCache.set(key, u);
      img.src = u;
    } catch {}
  });
}
function renderThumbs() {
  const box = $('#thumbs');
  box.replaceChildren();
  let dragFrom = null;
  S.pages.forEach((p, i) => {
    const img = el('img', { alt: 'Page ' + (i + 1), draggable: false });
    thumbSrc(p, img);
    const t = el(
      'div',
      { class: 'thumb', draggable: true },
      el(
        'button',
        {
          class: 'im',
          'aria-label': 'Go to page ' + (i + 1),
          onclick: () =>
            document
              .querySelector(`.pgw[data-id="${p.id}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        img,
      ),
      el('div', { class: 'mono muted', text: String(i + 1) }),
      el(
        'div',
        { class: 'act' },
        el('button', {
          title: 'Rotate left',
          'aria-label': 'Rotate page ' + (i + 1) + ' left',
          text: '↺',
          onclick: () => {
            pushUndo();
            rotatePage(p, 'ccw');
            renderStage();
          },
        }),
        el('button', {
          title: 'Rotate right',
          'aria-label': 'Rotate page ' + (i + 1) + ' right',
          text: '↻',
          onclick: () => {
            pushUndo();
            rotatePage(p, 'cw');
            renderStage();
          },
        }),
        el('button', {
          title: 'Duplicate',
          'aria-label': 'Duplicate page ' + (i + 1),
          text: '⧉',
          onclick: () => {
            pushUndo();
            const c = JSON.parse(JSON.stringify(p));
            c.id = uid();
            c.els.forEach((e) => (e.id = uid()));
            S.pages.splice(i + 1, 0, c);
            renderStage();
          },
        }),
        el('button', {
          title: 'Insert blank page after',
          'aria-label': 'Insert blank page after ' + (i + 1),
          text: '+',
          onclick: () => addBlank(i),
        }),
        el('button', {
          title: 'Delete',
          'aria-label': 'Delete page ' + (i + 1),
          text: '✕',
          onclick: () => {
            if (S.pages.length < 2) {
              toast('A PDF needs at least one page.');
              return;
            }
            pushUndo();
            S.pages.splice(i, 1);
            S.sel = null;
            renderStage();
          },
        }),
      ),
    );
    t.addEventListener('dragstart', (e) => {
      dragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(i));
      } catch {}
    });
    t.addEventListener('dragover', (e) => {
      if (dragFrom == null) return;
      e.preventDefault();
      t.classList.add('dragover');
    });
    t.addEventListener('dragleave', () => t.classList.remove('dragover'));
    t.addEventListener('drop', (e) => {
      e.preventDefault();
      t.classList.remove('dragover');
      if (dragFrom == null || dragFrom === i) return;
      pushUndo();
      const [m] = S.pages.splice(dragFrom, 1);
      S.pages.splice(i, 0, m);
      dragFrom = null;
      renderStage();
    });
    box.append(t);
  });
  box.append(
    el('button', {
      class: 'btn alt sm',
      text: 'Add blank page',
      onclick: () => addBlank(S.pages.length - 1),
    }),
  );
}
function addBlank(after) {
  pushUndo();
  const ref = S.pages[Math.max(0, after)];
  const w = ref ? pw(ref) : 595.28,
    h = ref ? ph(ref) : 841.89;
  S.pages.splice(after + 1, 0, { id: uid(), src: -1, rot: 0, nat: 0, w, h, els: [] });
  renderStage();
}
function rotatePage(p, dir) {
  const W = pw(p),
    H = ph(p);
  const map = dir === 'cw' ? (x, y) => [H - y, x] : (x, y) => [y, W - x];
  p.els.forEach((e) => {
    if (BOXY.has(e.type)) {
      const a = map(e.x, e.y),
        b = map(e.x + e.w, e.y + e.h);
      e.x = Math.min(a[0], b[0]);
      e.y = Math.min(a[1], b[1]);
      e.w = Math.abs(a[0] - b[0]);
      e.h = Math.abs(a[1] - b[1]);
    } else if (e.type === 'note') {
      [e.x, e.y] = map(e.x, e.y);
    } else if (e.type === 'line' || e.type === 'arrow') {
      [e.x1, e.y1] = map(e.x1, e.y1);
      [e.x2, e.y2] = map(e.x2, e.y2);
    } else if (e.type === 'draw') e.pts = e.pts.map((q) => map(q[0], q[1]));
  });
  p.rot = (p.rot + (dir === 'cw' ? 90 : 270)) % 360;
}

async function loadForm() {
  S.fields = [];
  try {
    const d = await PDFDocument.load(S.bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const form = d.getForm();
    for (const fl of form.getFields()) {
      const name = fl.getName();
      if (fl instanceof PDFLib.PDFTextField)
        S.fields.push({ name, kind: 'text', value: fl.getText() || '' });
      else if (fl instanceof PDFLib.PDFCheckBox)
        S.fields.push({ name, kind: 'check', value: fl.isChecked() });
      else if (fl instanceof PDFLib.PDFDropdown || fl instanceof PDFLib.PDFOptionList) {
        const s = fl.getSelected();
        S.fields.push({ name, kind: 'choice', options: fl.getOptions(), value: s[0] || '' });
      } else if (fl instanceof PDFLib.PDFRadioGroup)
        S.fields.push({
          name,
          kind: 'choice',
          options: fl.getOptions(),
          value: fl.getSelected() || '',
          radio: true,
        });
    }
  } catch (e) {
    console.warn('forms', e);
  }
}

async function buildPdf(onProgress) {
  fontFallbacks.clear();
  const src = await PDFDocument.load(S.bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  if (Object.keys(S.form).length) {
    try {
      const form = src.getForm();
      for (const fd of S.fields) {
        if (!(fd.name in S.form)) continue;
        const v = S.form[fd.name];
        try {
          const fl = form.getField(fd.name);
          if (fd.kind === 'text') fl.setText(sanitize(v));
          else if (fd.kind === 'check') v ? fl.check() : fl.uncheck();
          else if (fd.radio) v && fl.select(v);
          else if (v) fl.select(v);
        } catch (e) {
          console.warn(e);
        }
      }
      form.flatten();
    } catch (e) {
      console.warn('form flatten', e);
    }
  }
  const out = await PDFDocument.create();
  const cache = {};
  const title = src.getTitle();
  if (title) out.setTitle(title);
  out.setProducer('Pagewright');
  for (let i = 0; i < S.pages.length; i++) {
    const p = S.pages[i];
    onProgress && onProgress(i / S.pages.length);
    const redacts = p.els.filter((e) => e.type === 'redact');
    let page, g;
    if (p.src >= 0 && redacts.length) {
      const c = await renderPdfPage(S.doc, p.src, 2, (p.nat + p.rot) % 360);
      const x = c.getContext('2d');
      x.fillStyle = '#000';
      const k = c.width / pw(p);
      redacts.forEach((r) => x.fillRect(r.x * k, r.y * k, r.w * k, r.h * k));
      const im = await out.embedJpg(await (await canvasBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
      page = out.addPage([pw(p), ph(p)]);
      page.drawImage(im, { x: 0, y: 0, width: pw(p), height: ph(p) });
      g = { r: 0, x0: 0, y0: 0, W: pw(p), H: ph(p) };
    } else if (p.src >= 0) {
      [page] = await out.copyPages(src, [p.src]);
      page.setRotation(degrees((page.getRotation().angle + p.rot) % 360));
      out.addPage(page);
      g = geo(page);
    } else {
      page = out.addPage([p.w, p.h]);
      if (p.rot) page.setRotation(degrees(p.rot));
      g = geo(page);
    }
    await drawEls(
      out,
      page,
      g,
      p.els.filter((e) => e.type !== 'redact'),
      cache,
    );
  }
  return out.save();
}
async function drawEls(out, page, g, els, cache) {
  for (const e of els) {
    const op = e.op ?? 1;
    switch (e.type) {
      case 'rect':
      case 'whiteout':
        drawPath(page, g, boxPts(e), {
          fill: e.fill,
          stroke: e.stroke,
          sw: e.sw,
          op,
          close: true,
        });
        break;
      case 'ellipse':
        drawPath(page, g, ellPts(e), {
          fill: e.fill,
          stroke: e.stroke,
          sw: e.sw,
          op,
          close: true,
        });
        break;
      case 'markup':
        if (e.kind === 'highlight')
          drawPath(page, g, boxPts(e), { fill: e.color, op: e.op ?? 0.4, close: true });
        else {
          const yy = e.kind === 'underline' ? e.y + e.h - 1 : e.y + e.h / 2;
          drawPath(
            page,
            g,
            [
              [e.x, yy],
              [e.x + e.w, yy],
            ],
            { stroke: e.color, sw: Math.max(1.5, e.h * 0.08) },
          );
        }
        break;
      case 'line':
        drawPath(
          page,
          g,
          [
            [e.x1, e.y1],
            [e.x2, e.y2],
          ],
          { stroke: e.stroke, sw: e.sw, op },
        );
        break;
      case 'arrow': {
        drawPath(
          page,
          g,
          [
            [e.x1, e.y1],
            [e.x2, e.y2],
          ],
          { stroke: e.stroke, sw: e.sw, op },
        );
        const a = Math.atan2(e.y2 - e.y1, e.x2 - e.x1),
          L = Math.max(10, e.sw * 5),
          s = 0.45;
        drawPath(
          page,
          g,
          [
            [e.x2, e.y2],
            [e.x2 - L * Math.cos(a - s), e.y2 - L * Math.sin(a - s)],
            [e.x2 - L * Math.cos(a + s), e.y2 - L * Math.sin(a + s)],
          ],
          { fill: e.stroke, op, close: true },
        );
        break;
      }
      case 'draw':
        drawPath(page, g, e.pts.length > 1 ? e.pts : [e.pts[0], [e.pts[0][0] + 0.1, e.pts[0][1]]], {
          stroke: e.stroke,
          sw: e.sw,
          op,
        });
        break;
      case 'image': {
        const im = S.imgs[e.img];
        if (!im) break;
        const key = 'img' + e.img;
        if (!cache[key])
          cache[key] =
            im.mime === 'image/png' ? await out.embedPng(im.bytes) : await out.embedJpg(im.bytes);
        const [ux, uy] = U(g, e.x, e.y + e.h);
        page.drawImage(cache[key], {
          x: ux,
          y: uy,
          width: e.w,
          height: e.h,
          rotate: degrees(g.r),
          opacity: op,
        });
        break;
      }
      case 'text': {
        if (!e.text) break;
        const f = await getFont(out, cache, e.font, e.bold, e.italic);
        const ls = e.ls || 0;
        const fm = { widthOfTextAtSize: (t, z) => f.widthOfTextAtSize(t, z) + ls * t.length };
        const lines = wrapText(fm, e.size, sanitize(e.text), e.w + 1);
        const lh = e.size * 1.2;
        const col = hex2rgb(e.color);
        const lw = Math.max(0.5, e.size / 16);
        lines.forEach((ln, i) => {
          const w = fm.widthOfTextAtSize(ln, e.size) - (ln ? ls : 0);
          const x =
            e.align === 'center' ? e.x + (e.w - w) / 2 : e.align === 'right' ? e.x + e.w - w : e.x;
          const by = e.y + i * lh + e.size * 0.95;
          if (ln && ls) {
            let cx = x;
            for (const ch of ln) {
              const [ux, uy] = U(g, cx, by);
              page.drawText(ch, {
                x: ux,
                y: uy,
                size: e.size,
                font: f,
                color: col,
                rotate: degrees(g.r),
              });
              cx += f.widthOfTextAtSize(ch, e.size) + ls;
            }
          } else if (ln) {
            const [ux, uy] = U(g, x, by);
            page.drawText(ln, {
              x: ux,
              y: uy,
              size: e.size,
              font: f,
              color: col,
              rotate: degrees(g.r),
            });
          }
          const rule = (dy) => {
            const a = U(g, x, by + dy);
            const b = U(g, x + w, by + dy);
            page.drawLine({
              start: { x: a[0], y: a[1] },
              end: { x: b[0], y: b[1] },
              thickness: lw,
              color: col,
            });
          };
          if (ln && e.under) rule(e.size * 0.12);
          if (ln && e.strike) rule(-e.size * 0.3);
        });
        break;
      }
      case 'note': {
        const s = 14;
        drawPath(page, g, boxPts({ x: e.x, y: e.y, w: s, h: s }), {
          fill: '#ffd23f',
          stroke: '#b88a00',
          sw: 0.8,
          close: true,
        });
        const a = U(g, e.x, e.y),
          b = U(g, e.x + s, e.y + s);
        const annot = out.context.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.max(a[0], b[0]),
            Math.max(a[1], b[1]),
          ],
          Contents: PDFHexString.fromText(sanitize(e.text || '')),
          Name: 'Comment',
          C: [1, 0.82, 0.25],
          F: 4,
        });
        page.node.addAnnot(out.context.register(annot));
        if (e.text) {
          const nf = await getFont(out, cache, 'Helvetica', false, false);
          const ns = 9;
          const nl = wrapText(nf, ns, sanitize(e.text), 150).slice(0, 14);
          const nw = Math.max(...nl.map((t) => nf.widthOfTextAtSize(t, ns))) + 8;
          const nh = nl.length * ns * 1.25 + 6;
          const nx = e.x + s + 3;
          drawPath(page, g, boxPts({ x: nx, y: e.y, w: nw, h: nh }), {
            fill: '#fff6c8',
            stroke: '#e0b800',
            sw: 0.6,
            close: true,
          });
          nl.forEach((t, i) => {
            const [tx, ty] = U(g, nx + 4, e.y + 3 + i * ns * 1.25 + ns * 0.95);
            if (t)
              page.drawText(t, {
                x: tx,
                y: ty,
                size: ns,
                font: nf,
                color: hex2rgb('#3b2f00'),
                rotate: degrees(g.r),
              });
          });
        }
        break;
      }
    }
  }
}
async function downloadPdf() {
  const b = $('#btnDl');
  let saved = false;
  b.disabled = true;
  toast('Preparing your PDF…', 8000);
  try {
    const bytes = await buildPdf();
    saved = await offer(baseName(S.name) + '-edited.pdf', bytes);
    if (saved) S.dirty = false;
    if (fontFallbacks.size)
      toast(
        'Could not load ' +
          [...fontFallbacks].join(', ') +
          ', so Helvetica was used. Check your connection.',
        7000,
      );
  } catch (e) {
    console.error(e);
    toast('Could not create the PDF: ' + (e.message || e), 6000);
  } finally {
    b.disabled = false;
  }
  return saved;
}

function resetEditor() {
  Object.values(S.imgs).forEach((im) => URL.revokeObjectURL(im.url));
  io.disconnect();
  if (S.doc) S.doc.destroy().catch(() => {});
  Object.assign(S, {
    bytes: null,
    name: '',
    doc: null,
    pages: [],
    tool: 'select',
    sel: null,
    undo: [],
    redo: [],
    form: {},
    fields: [],
    imgs: {},
    place: null,
    editing: null,
    dirty: false,
    panelFocus: null,
  });
  thumbCache.clear();
  tiCache.clear();
  $('#stage').replaceChildren();
  $('#stage').dataset.tool = 'select';
  $('#thumbs').replaceChildren();
  $('#side').replaceChildren();
  $('#edEmpty').hidden = false;
  $('#edApp').hidden = true;
}

function confirmLeave(onLeave) {
  const root = $('#modalRoot');
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    root.replaceChildren();
    document.removeEventListener('keydown', onKey);
  };
  document.addEventListener('keydown', onKey);
  const keep = el('button', { class: 'btn block', text: 'Keep editing', onclick: close });
  const leave = el('button', {
    class: 'btn alt block',
    text: 'Leave without saving',
    onclick: () => {
      close();
      onLeave();
    },
  });
  root.replaceChildren(
    el(
      'div',
      {
        class: 'modal',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': 'leaveTitle',
      },
      el(
        'div',
        { class: 'slim' },
        el('h3', { id: 'leaveTitle', text: 'Leave your work?' }),
        el('p', {
          class: 'muted',
          style: 'margin:0',
          text: tl(
            'Pagewright has no save function. {name} only exists in this tab until you download it. If you leave now, your work is lost.',
            { name: S.name },
          ),
        }),
        el('div', { class: 'stack tight' }, keep, leave),
      ),
    ),
  );
  keep.focus();
}

function closeEditor() {
  const done = () => {
    resetEditor();
    enterEditor('select');
  };
  if (S.dirty) confirmLeave(done);
  else done();
}

window.addEventListener('beforeunload', (e) => {
  if (S.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.body.append(
  el(
    'datalist',
    { id: 'pw-sizes' },
    [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96].map((n) =>
      el('option', { value: n }),
    ),
  ),
);
const NODE_REC = new WeakMap();
const ATTR_REC = new WeakMap();
const I18N_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const I18N_SKIP = '[contenteditable],.ov,.pgw,input,textarea,script,style,datalist,.nox';
const I18N_ATTR_SKIP = '[contenteditable],.ov,.pgw,script,style,datalist,.nox';
function langDict() {
  const l = LANGS[curLang];
  return (l && l.t) || null;
}
function tl(s, vars) {
  const d = langDict();
  let out = d && d[s] != null ? d[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}
const TPL_CACHE = {};
function templates() {
  const d = langDict();
  if (!d) return [];
  if (TPL_CACHE[curLang]) return TPL_CACHE[curLang];
  const list = [];
  Object.keys(d).forEach((k) => {
    if (!/\{[ntxr]\}/.test(k)) return;
    const body = k
      .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
      .replace(/\{n\}/g, '(?<n>\\d+)')
      .replace(/\{t\}/g, '(?<t>\\d+)')
      .replace(/\{x\}/g, '(?<x>.+?)')
      .replace(/\{r\}/g, '(?<r>.+)');
    list.push({ re: new RegExp('^' + body + '$'), out: d[k] });
  });
  return (TPL_CACHE[curLang] = list);
}
function xlate(src) {
  const d = langDict();
  if (!d) return src;
  const m = src.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const key = m[2].replace(/\s+/g, ' ');
  if (!key) return src;
  if (d[key] != null) return m[1] + d[key] + m[3];
  for (const t of templates()) {
    const g = key.match(t.re);
    if (g)
      return (
        m[1] +
        t.out.replace(/\{([ntxr])\}/g, (_, k) => (k === 'r' ? xlate(g.groups.r) : g.groups[k])) +
        m[3]
      );
  }
  return src;
}
function xText(n) {
  const rec = NODE_REC.get(n);
  const src = rec && n.nodeValue === rec.tr ? rec.o : n.nodeValue;
  const out = xlate(src);
  NODE_REC.set(n, { o: src, tr: out });
  if (out !== n.nodeValue) n.nodeValue = out;
}
function xAttrs(e) {
  I18N_ATTRS.forEach((a) => {
    if (!e.hasAttribute(a)) return;
    const recs = ATTR_REC.get(e) || {};
    const cur = e.getAttribute(a);
    const rec = recs[a];
    const src = rec && cur === rec.tr ? rec.o : cur;
    const out = xlate(src);
    recs[a] = { o: src, tr: out };
    ATTR_REC.set(e, recs);
    if (out !== cur) e.setAttribute(a, out);
  });
}
function xTree(root) {
  if (root.nodeType === 3) {
    if (!root.parentElement || !root.parentElement.closest(I18N_SKIP)) xText(root);
    return;
  }
  if (root.nodeType !== 1 || root.closest(I18N_ATTR_SKIP)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n = root;
  do {
    if (n.nodeType === 3) {
      if (!n.parentElement.closest(I18N_SKIP)) xText(n);
    } else if (!n.closest(I18N_ATTR_SKIP)) xAttrs(n);
  } while ((n = w.nextNode()));
}
const i18nObs = new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === 'childList') m.addedNodes.forEach(xTree);
    else if (m.type === 'characterData') xTree(m.target);
    else if (m.type === 'attributes') {
      if (!m.target.closest(I18N_ATTR_SKIP)) xAttrs(m.target);
    }
  }
});
function startI18n() {
  i18nObs.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: I18N_ATTRS,
  });
}
const FIT_SEL =
  '.hero h1,.hero p,.sec h2,.tabpanel,.card h3,.card p,.foot>div,.foot-col h5,.foot-col a,.foot-brand p,.mi,.drop b,.drop .muted,.stats span,.foot-copy,.foot-note,.nav-link,#megaBtn';
function fitAll(root) {
  const els = [...(root || document).querySelectorAll(FIT_SEL)];
  els.forEach((e) => (e.style.fontSize = ''));
  const over = (e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1;
  const meta = new Map();
  let todo = els.filter((e) => e.getClientRects().length && over(e));
  todo.forEach((e) => {
    const fs = parseFloat(getComputedStyle(e).fontSize);
    meta.set(e, { fs, min: fs * 0.6 });
  });
  for (let i = 0; i < 24 && todo.length; i++) {
    todo.forEach((e) => {
      const m = meta.get(e);
      m.fs = Math.max(m.min, m.fs * 0.95);
      e.style.fontSize = m.fs + 'px';
    });
    todo = todo.filter((e) => over(e) && meta.get(e).fs > meta.get(e).min);
  }
}
function centerNav() {
  const n = $('.nav-link'),
    m = $('#megaBtn'),
    b = $('.brand');
  if (!n || !m || !b) return;
  n.style.left = '0px';
  if (!n.getClientRects().length || !m.getClientRects().length) return;
  const tr = (e) => {
    const r = document.createRange();
    r.selectNodeContents(e);
    return r.getBoundingClientRect();
  };
  const nt = tr(n),
    mt = tr(m);
  const gl = nt.left - b.getBoundingClientRect().right;
  const gr = mt.left - nt.right;
  n.style.left = Math.round((gr - gl) / 2) + 'px';
}
let fitTimer = 0;
function fitSoon() {
  cancelAnimationFrame(fitTimer);
  fitTimer = requestAnimationFrame(() => {
    fitAll();
    centerNav();
  });
}
window.addEventListener('resize', fitSoon);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSoon);
function setLang(code, remember = true) {
  if (!LANGS[code]) code = 'en';
  curLang = code;
  const l = LANGS[code];
  document.documentElement.lang = code;
  document.documentElement.dir = l.rtl ? 'rtl' : 'ltr';
  i18nObs.disconnect();
  xTree(document.body);
  startI18n();
  const nm = $('#footLangName');
  if (nm) nm.textContent = l.name;
  syncThemeBtn();
  fitSoon();
  document.title = curTool ? tl(curTool.name) + ' · Pagewright' : 'Pagewright';
  if (remember) {
    try {
      localStorage.setItem('pw-lang', code);
    } catch {}
  }
}
function detectLang() {
  try {
    const saved = localStorage.getItem('pw-lang');
    if (saved && LANGS[saved]) return saved;
  } catch {}
  const list =
    navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const raw of list) {
    const l = String(raw || '').toLowerCase();
    if (/^zh-(tw|hk|mo|hant)/.test(l) && LANGS['zh-TW']) return 'zh-TW';
    const base = l.split('-')[0];
    if (LANGS[base]) return base;
  }
  return 'en';
}
let langPop = null;
function closeLang() {
  if (langPop) {
    langPop.remove();
    langPop = null;
  }
  $('#langBtn').setAttribute('aria-expanded', 'false');
  $('#footLang').setAttribute('aria-expanded', 'false');
}
function openLang(anchor, up) {
  closeLang();
  const pop = el('div', { class: 'langpop', role: 'menu' });
  LANG_ORDER.forEach((code) => {
    const b = el(
      'button',
      {
        class: 'lang-item' + (code === curLang ? ' on' : ''),
        role: 'menuitemradio',
        'aria-checked': code === curLang ? 'true' : 'false',
        lang: code,
        onclick: () => {
          setLang(code);
          closeLang();
        },
      },
      el('span', { class: 'tick', text: code === curLang ? '✓' : '' }),
      el('span', { class: 'nox', text: LANGS[code].name }),
    );
    pop.append(b);
  });
  document.body.append(pop);
  langPop = pop;
  anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const rtl = document.documentElement.dir === 'rtl';
  const want = up || rtl ? (rtl ? r.right - w : r.left) : r.right - w;
  pop.style.left = clamp(want, 8, Math.max(8, vw - w - 8)) + 'px';
  const room = up ? r.top - 16 : vh - r.bottom - 16;
  pop.style.maxHeight = Math.max(160, Math.min(vh - 16, room + 8)) + 'px';
  const ph = Math.min(h, pop.offsetHeight);
  pop.style.top = clamp(up ? r.top - ph - 8 : r.bottom + 8, 8, Math.max(8, vh - ph - 8)) + 'px';
  const cur = $('.lang-item.on', pop);
  if (cur) cur.focus();
}
$('#langBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  langPop ? closeLang() : openLang($('#langBtn'), false);
});
$('#footLang').addEventListener('click', (e) => {
  e.stopPropagation();
  langPop ? closeLang() : openLang($('#footLang'), true);
});
document.addEventListener('click', (e) => {
  if (langPop && !langPop.contains(e.target)) closeLang();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLang();
    closeDrawer();
  }
});
window.addEventListener('resize', closeLang);
window.addEventListener(
  'scroll',
  (e) => {
    if (langPop && !langPop.contains(e.target)) closeLang();
  },
  true,
);

const drawer = $('#drawer');
const burger = $('#burger');
function openDrawer() {
  fitSoon();
  $$('.mi', drawer).forEach((a) =>
    a.classList.toggle('cur', a.dataset.id === (curTool && curTool.id)),
  );
  drawer.hidden = false;
  burger.setAttribute('aria-expanded', 'true');
  document.body.classList.add('noscroll');
}
function closeDrawer() {
  drawer.hidden = true;
  burger.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('noscroll');
}
burger.addEventListener('click', () => (drawer.hidden ? openDrawer() : closeDrawer()));
$('#drawerClose').addEventListener('click', closeDrawer);
$('#drawerScrim').addEventListener('click', closeDrawer);
drawer.addEventListener('click', (e) => e.target.closest('a') && closeDrawer());

function buildFooter() {
  const c = $('#footCols');
  GROUPS.forEach(([g, label]) => {
    const d = el('div', { class: 'foot-col' }, el('h5', { text: label }));
    TOOLS.filter((t) => t.group === g).forEach((t) =>
      d.append(el('a', { href: '#' + t.id, text: t.name })),
    );
    c.append(d);
  });
}

buildMega();
buildFooter();
buildHome();
route();
setLang(detectLang(), false);
