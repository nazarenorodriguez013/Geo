const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MAX_TRAIL = 100;

if (!ADMIN_KEY) {
  console.error('Falta la variable de entorno ADMIN_KEY');
  process.exit(1);
}

let sellers = {};
try { sellers = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(sellers), () => {});
  }, 2000);
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  const given = Buffer.from(req.headers['x-admin-key'] || '');
  const real = Buffer.from(ADMIN_KEY);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

const num = (v, min, max) => typeof v === 'number' && v >= min && v <= max;

function record(token, lat, lng, acc) {
  const s = sellers[token];
  if (!s) return null;
  const point = { lat, lng, acc: num(acc, 0, 1e6) ? acc : null, ts: Date.now() };
  s.last = point;
  s.trail = (s.trail || []).concat([[lat, lng, point.ts]]).slice(-MAX_TRAIL);
  save();
  return s;
}

// Traccar Client: OsmAnd protocol (query string / form) or the newer JSON body
function parseTraccar(url, body) {
  const q = Object.fromEntries(url.searchParams);
  const f = typeof body === 'string' ? Object.fromEntries(new URLSearchParams(body)) : {};
  const j = body && typeof body === 'object' ? body : {};
  const c = j.location && j.location.coords;
  const get = k => q[k] ?? f[k];
  return {
    id: String(get('id') ?? j.device_id ?? ''),
    lat: parseFloat(get('lat') ?? (c && c.latitude)),
    lng: parseFloat(get('lon') ?? (c && c.longitude)),
    acc: parseFloat(get('accuracy') ?? get('hdop') ?? (c && c.accuracy))
  };
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // Traccar Client reports to the server root (or /traccar)
    if ((p === '/' || p === '/traccar') && (req.method === 'POST' || url.searchParams.has('lat'))) {
      const raw = req.method === 'POST' ? await readRaw(req) : '';
      let body = raw;
      try { body = JSON.parse(raw); } catch {}
      const t = parseTraccar(url, body);
      if (!num(t.lat, -90, 90) || !num(t.lng, -180, 180)) return send(res, 400, { error: 'datos inválidos' });
      return record(t.id, t.lat, t.lng, t.acc) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'id desconocido' });
    }

    // Seller sends position
    let m = p.match(/^\/api\/ping\/([a-f0-9]{16})$/);
    if (m && req.method === 'POST') {
      if (!sellers[m[1]]) return send(res, 404, { error: 'link inválido' });
      const b = await readBody(req);
      if (!num(b.lat, -90, 90) || !num(b.lng, -180, 180)) return send(res, 400, { error: 'datos inválidos' });
      const s = record(m[1], b.lat, b.lng, b.acc);
      return send(res, 200, { ok: true, name: s.name });
    }

    // Seller name lookup (to greet them)
    m = p.match(/^\/api\/me\/([a-f0-9]{16})$/);
    if (m && req.method === 'GET') {
      const s = sellers[m[1]];
      return s ? send(res, 200, { name: s.name }) : send(res, 404, { error: 'link inválido' });
    }

    // Admin API
    if (p.startsWith('/api/sellers')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'clave incorrecta' });

      if (p === '/api/sellers' && req.method === 'GET') {
        return send(res, 200, Object.entries(sellers).map(([token, s]) => ({
          token, name: s.name, last: s.last || null, trail: s.trail || []
        })));
      }
      if (p === '/api/sellers' && req.method === 'POST') {
        const b = await readBody(req);
        const name = String(b.name || '').trim().slice(0, 60);
        if (!name) return send(res, 400, { error: 'falta el nombre' });
        const token = crypto.randomBytes(8).toString('hex');
        sellers[token] = { name, last: null, trail: [] };
        save();
        return send(res, 200, { token, name });
      }
      m = p.match(/^\/api\/sellers\/([a-f0-9]{16})$/);
      if (m && req.method === 'DELETE') {
        delete sellers[m[1]];
        save();
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'no encontrado' });
    }

    // Static images
    m = p.match(/^\/img\/([a-z0-9_-]+\.(?:jpg|jpeg|png|webp))$/i);
    if (m) {
      const imgPath = path.join(__dirname, 'public', 'img', m[1]);
      const ext = path.extname(imgPath).slice(1).toLowerCase();
      const type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return fs.access(imgPath, fs.constants.R_OK, err => {
        if (err) return send(res, 404, { error: 'no encontrado' });
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(imgPath).pipe(res);
      });
    }

    // Pages
    const file = /^\/s\/[a-f0-9]{16}$/.test(p) ? 'seller.html'
      : p === '/' || p === '/admin' ? 'admin.html' : null;
    if (file) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(__dirname, 'public', file)).pipe(res);
    }
    send(res, 404, { error: 'no encontrado' });
  } catch (e) {
    send(res, 400, { error: 'solicitud inválida' });
  }
});

server.listen(PORT, () => console.log(`Geo escuchando en :${PORT}`));
