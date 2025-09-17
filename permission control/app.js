/**
 * app.js
 * Minimal Node.js server demonstrating RBAC + ABAC without external deps.
 *
 * Run: node app.js
 *
 * Notes:
 * - Uses built-in 'http', 'url', 'crypto' only.
 * - Simple in-memory stores for users, roles, resources, sessions.
 * - Tokens are simple HMAC-signed JSON blobs (not JWT lib) with expiry.
 * - This is educational code — do NOT use "as-is" in production.
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');

// ---------- CONFIG ----------
const PORT = 3000;
const HMAC_SECRET = 'dev-secret-change-me'; // store securely in env in real world
const TOKEN_TTL = 60 * 60; // token lifetime seconds

// ---------- UTIL ----------
function nowSec() { return Math.floor(Date.now() / 1000); }

function hashPassword(password, salt) {
    // pbkdf2 sync for simplicity
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
}

function signToken(payloadObj) {
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
    const sig = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('base64');
    return `${payload}.${sig}`;
}

function verifyToken(token) {
    try {
        const [payloadB64, sig] = token.split('.');
        if (!payloadB64 || !sig) return null;
        const expected = crypto.createHmac('sha256', HMAC_SECRET).update(payloadB64).digest('base64');
        if (!timingSafeEqual(sig, expected)) return null;
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
        if (payload.exp && nowSec() > payload.exp) return null;
        return payload;
    } catch (e) { return null; }
}

function timingSafeEqual(a, b) {
    const A = Buffer.from(a);
    const B = Buffer.from(b);
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
}

function parseJSONBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            if (!body) return resolve(null);
            try { resolve(JSON.parse(body)); } catch (e) { resolve({ __parseError: true, raw: body }); }
        });
    });
}

// ---------- In-memory stores (for demo) ----------
const users = {}; // username -> { username, salt, passHash, roles:[], attrs:{} }
const roles = {}; // roleName -> { permissions: Set(...) }
const docs = {};  // docId -> { id, title, content, owner, sensitivity, attrs:{} }
let nextDocId = 1;

// ---------- RBAC Setup ----------
function addRole(name, perms) {
    roles[name] = { permissions: new Set(perms) };
}

function roleHasPermission(roleName, perm) {
    const r = roles[roleName];
    return r && r.permissions.has(perm);
}

// ---------- ABAC Setup ----------
/**
 * ABAC policies are functions (userAttrs, resourceAttrs, action, context) => boolean
 * We'll keep a small policy list and evaluate them (deny-by-default).
 */
const abacPolicies = [];

// helper to register policy
function registerPolicy(fn) { abacPolicies.push(fn); }

// examples:
//  - owner can do anything on their resource
registerPolicy((user, resource, action, ctx) => {
    if (!resource || !user) return false;
    return resource.owner === user.username;
});

//  - sensitive docs can only be read by users with clearance >= resource.sensitivity
registerPolicy((user, resource, action) => {
    if (!resource) return false;
    if (action === 'doc:read' && resource.sensitivity) {
        const userClearance = (user.attrs && user.attrs.clearance) || 0;
        return userClearance >= resource.sensitivity;
    }
    return false;
});

//  - time-bound policy example: editing only allowed 09:00-18:00 UTC
registerPolicy((user, resource, action) => {
    if (action === 'doc:edit') {
        const hour = new Date().getUTCHours();
        return hour >= 9 && hour < 18;
    }
    return false;
});

// Evaluate ABAC: return true if ANY policy allows. (deny-by-default)
function evaluateABAC(user, resource, action, ctx = {}) {
    for (const p of abacPolicies) {
        try {
            if (p(user, resource, action, ctx)) return true;
        } catch (e) {
            // policy error -> treat as false but log
            console.error('policy error', e);
        }
    }
    return false;
}

// ---------- User & Role Bootstrapping ----------
function createUser(username, password, rolesList = [], attrs = {}) {
    const salt = crypto.randomBytes(8).toString('hex');
    const passHash = hashPassword(password, salt);
    users[username] = { username, salt, passHash, roles: rolesList.slice(), attrs: Object.assign({}, attrs) };
    return users[username];
}

// Setup roles & users
addRole('reader', ['doc:read']);
addRole('editor', ['doc:read', 'doc:edit', 'doc:create']);
addRole('admin', ['doc:read', 'doc:edit', 'doc:create', 'doc:delete', 'admin:*']);

createUser('alice', 'password1', ['reader'], { clearance: 1 });
createUser('bob', 'password2', ['editor'], { clearance: 2 });
createUser('carol', 'password3', ['admin'], { clearance: 5 });

// create a sample doc
function createDoc(title, content, owner, sensitivity = 0, attrs = {}) {
    const id = String(nextDocId++);
    docs[id] = { id, title, content, owner, sensitivity, attrs: Object.assign({}, attrs) };
    return docs[id];
}
createDoc('Public doc', 'hello world', 'bob', 0);
createDoc('Sensitive plan', 'top secret', 'carol', 4);

// ---------- Auth: login and token ----------
async function handleLogin(req, res) {
    const body = await parseJSONBody(req);
    if (!body || !body.username || !body.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'username & password required' })); return;
    }
    const u = users[body.username];
    if (!u) { res.writeHead(401); res.end(JSON.stringify({ error: 'invalid' })); return; }
    const attempt = hashPassword(body.password, u.salt);
    if (attempt !== u.passHash) { res.writeHead(401); res.end(JSON.stringify({ error: 'invalid' })); return; }

    const payload = {
        username: u.username,
        roles: u.roles,
        attrs: u.attrs,
        iat: nowSec(),
        exp: nowSec() + TOKEN_TTL
    };
    const token = signToken(payload);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ token }));
}

// ---------- Middleware-like helpers ----------
function authenticate(req) {
    const auth = req.headers['authorization'];
    if (!auth) return null;
    // expect "Bearer <token>"
    const parts = auth.split(' ');
    if (parts.length !== 2) return null;
    const token = parts[1];
    const payload = verifyToken(token);
    if (!payload) return null;
    // attach live user object from store (fresh attrs/roles)
    const u = users[payload.username];
    if (!u) return null;
    return { ...u, roles: u.roles, attrs: u.attrs };
}

function authorizeRBAC(user, perm) {
    if (!user) return false;
    for (const r of user.roles) {
        if (roleHasPermission(r, perm)) return true;
        // wildcard support: admin:* => allow all
        if (roles[r] && Array.from(roles[r].permissions).some(p => p.endsWith(':*') && perm.startsWith(p.split(':')[0] + ':'))) return true;
    }
    return false;
}

// Combined check: RBAC OR ABAC (common real-world pattern: positive if either allows)
// You can change to require both, or prefer deny overrides.
function isAllowed(user, resource, action, ctx = {}) {
    if (!user) return false;
    if (authorizeRBAC(user, action)) return true;
    if (evaluateABAC(user, resource, action, ctx)) return true;
    return false;
}

// ---------- HTTP Routes ----------
async function handleRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const method = req.method;
    const path = parsed.pathname;

    // simple router:
    if (method === 'POST' && path === '/login') { return handleLogin(req, res); }

    // require auth for everything else in this demo:
    const user = authenticate(req);
    if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthenticated' })); return; }

    // docs: GET /docs -> list; GET /docs/:id ; POST /docs ; PUT /docs/:id ; DELETE /docs/:id
    if (path === '/docs' && method === 'GET') {
        // list filtered by ABAC: only include docs readable by user
        const out = Object.values(docs).filter(d => isAllowed(user, d, 'doc:read')).map(d => ({ id: d.id, title: d.title, owner: d.owner, sensitivity: d.sensitivity }));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
    }

    const docGetMatch = path.match(/^\/docs\/([^\/]+)$/);
    if (docGetMatch && method === 'GET') {
        const id = docGetMatch[1];
        const doc = docs[id];
        if (!doc) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
        if (!isAllowed(user, doc, 'doc:read')) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(doc)); return;
    }

    if (path === '/docs' && method === 'POST') {
        if (!isAllowed(user, null, 'doc:create')) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
        const body = await parseJSONBody(req);
        if (!body || !body.title || !('content' in body)) { res.writeHead(400); res.end(JSON.stringify({ error: 'bad body' })); return; }
        const sensitivity = body.sensitivity || 0;
        const doc = createDoc(body.title, body.content, user.username, sensitivity, body.attrs || {});
        res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(doc)); return;
    }

    if (docGetMatch && method === 'PUT') {
        const id = docGetMatch[1];
        const doc = docs[id];
        if (!doc) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
        // For edit we require 'doc:edit' permission or ABAC policy allows
        if (!isAllowed(user, doc, 'doc:edit')) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
        const body = await parseJSONBody(req);
        if (!body) { res.writeHead(400); res.end(JSON.stringify({ error: 'bad body' })); return; }
        doc.title = body.title ?? doc.title;
        doc.content = body.content ?? doc.content;
        doc.sensitivity = body.sensitivity ?? doc.sensitivity;
        doc.attrs = Object.assign(doc.attrs || {}, body.attrs || {});
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(doc)); return;
    }

    if (docGetMatch && method === 'DELETE') {
        const id = docGetMatch[1];
        const doc = docs[id];
        if (!doc) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return; }
        if (!isAllowed(user, doc, 'doc:delete')) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
        delete docs[id];
        res.writeHead(204); res.end(); return;
    }

    // fallback: show simple status
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, message: 'not found' }));
}

// ---------- Start server ----------
const server = http.createServer((req, res) => {
    // tiny logger
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    handleRequest(req, res).catch(err => {
        console.error('handler error', err);
        res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'internal' }));
    });
});

server.listen(PORT, () => {
    console.log(`RBAC+ABAC demo server running at http://localhost:${PORT}`);
    console.log('Users: alice(password1)[reader], bob(password2)[editor], carol(password3)[admin]');
});
