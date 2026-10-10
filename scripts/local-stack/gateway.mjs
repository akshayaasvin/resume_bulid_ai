// Local stand-in for the Supabase HTTP API, for e2e and load tests without a real project.
//   /rest/v1/*     -> proxied to PostgREST (real RLS in real Postgres)
//   /auth/v1/*     -> tiny GoTrue-compatible subset: admin create/delete user, password + refresh
//                     token grants, /user, /logout
//   /storage/v1/*  -> object upload/download on local disk, owner-folder policy like ours
// NOT for production. See scripts/local-stack/README.md.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { sign, verify } from './jwt.mjs';

export function startGateway({ port, postgrestUrl, dbUrl, jwtSecret, storageDir }) {
  const pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
  const refreshTokens = new Map(); // token -> user id
  mkdirSync(storageDir, { recursive: true });

  const userJson = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.created_at, phone: '', confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data ?? {},
    identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
  });

  function session(u) {
    const now = Math.floor(Date.now() / 1000);
    const access = sign({
      sub: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, iat: now, exp: now + 3600,
      session_id: randomUUID(), aal: 'aal1', app_metadata: { provider: 'email' }, user_metadata: u.raw_user_meta_data ?? {},
    }, jwtSecret);
    const refresh = randomBytes(24).toString('hex');
    refreshTokens.set(refresh, u.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const claims = (req) => verify((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''), jwtSecret);

  async function auth(req, res, url) {
    const p = url.pathname.replace(/^\/auth\/v1/, '');
    const c = claims(req);
    if (p === '/admin/users' && req.method === 'POST') {
      if (c?.role !== 'service_role') return send(res, 401, { msg: 'service role required' });
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const hash = await bcrypt.hash(body.password, 10);
      try {
        const { rows: [u] } = await pool.query(
          `insert into auth.users(email, encrypted_password, raw_user_meta_data) values ($1,$2,$3) returning *`,
          [body.email.toLowerCase(), hash, body.user_metadata ?? {}],
        );
        return send(res, 200, userJson(u));
      } catch (e) {
        if (e.code === '23505') return send(res, 422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
        throw e;
      }
    }
    const del = p.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
    if (del && req.method === 'DELETE') {
      if (c?.role !== 'service_role') return send(res, 401, { msg: 'service role required' });
      await pool.query('delete from auth.users where id = $1', [del[1]]);
      return send(res, 200, {});
    }
    if (p === '/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (grant === 'password') {
        const { rows: [u] } = await pool.query('select * from auth.users where email = $1', [String(body.email ?? '').toLowerCase()]);
        if (!u || !(await bcrypt.compare(String(body.password ?? ''), u.encrypted_password ?? ''))) {
          return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        }
        return send(res, 200, session(u));
      }
      if (grant === 'refresh_token') {
        const uid = refreshTokens.get(body.refresh_token);
        if (!uid) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        refreshTokens.delete(body.refresh_token);
        const { rows: [u] } = await pool.query('select * from auth.users where id = $1', [uid]);
        if (!u) return send(res, 400, { code: 400, msg: 'user gone' });
        return send(res, 200, session(u));
      }
      return send(res, 400, { msg: 'unsupported grant' });
    }
    if (p === '/user' && req.method === 'GET') {
      if (!c?.sub) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      const { rows: [u] } = await pool.query('select * from auth.users where id = $1', [c.sub]);
      if (!u) return send(res, 403, { code: 403, error_code: 'user_not_found', msg: 'User not found' });
      return send(res, 200, userJson(u));
    }
    if (p === '/logout') return send(res, 204);
    return send(res, 404, { msg: `not implemented in local stack: ${req.method} ${p}` });
  }

  async function storage(req, res, url) {
    const m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (!m) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'not implemented in local stack' });
    const [, bucket, objPath] = m;
    const safe = path.normalize(decodeURIComponent(objPath)).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(storageDir, bucket, safe);
    const c = claims(req);
    if (req.method === 'POST' || req.method === 'PUT') {
      if (c?.role !== 'service_role') return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, await readBody(req));
      return send(res, 200, { Key: `${bucket}/${safe}`, Id: randomUUID() });
    }
    if (req.method === 'GET') {
      const owner = safe.split(/[/\\]/)[0];
      const allowed = c?.role === 'service_role' || (c?.role === 'authenticated' && c.sub === owner);
      if (!allowed || !existsSync(file)) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(readFileSync(file));
    }
    return send(res, 405, {});
  }

  async function rest(req, res, url) {
    const target = `${postgrestUrl}${url.pathname.replace(/^\/rest\/v1/, '')}${url.search}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
    const r = await fetch(target, { method: req.method, headers, body });
    const out = Buffer.from(await r.arrayBuffer());
    const h = {};
    r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) h[k] = v; });
    res.writeHead(r.status, h);
    res.end(out);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return send(res, 204);
    try {
      if (url.pathname.startsWith('/auth/v1')) return await auth(req, res, url);
      if (url.pathname.startsWith('/storage/v1')) return await storage(req, res, url);
      if (url.pathname.startsWith('/rest/v1')) return await rest(req, res, url);
      return send(res, 404, { msg: 'unknown path' });
    } catch (e) {
      console.error('[gateway]', e);
      return send(res, 500, { msg: String(e.message ?? e) });
    }
  });
  server.keepAliveTimeout = 65_000;
  return new Promise((resolve) => server.listen(port, () => resolve({ server, pool })));
}
