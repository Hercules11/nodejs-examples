// server.js
// Simple chunked upload + resume + merge server using only Node core modules.
// Node >= 14 recommended.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const PORT = 3000;

const TMP_DIR = path.resolve(__dirname, 'tmp');
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');

async function ensureDirs() {
    await fsp.mkdir(TMP_DIR, { recursive: true });
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

function jsonRes(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function parseUrlParams(url) {
    const u = new URL(url, `http://localhost`);
    return Object.fromEntries(u.searchParams.entries());
}

function metaPath(fileId) {
    return path.join(TMP_DIR, `${fileId}.meta.json`);
}
function chunkPath(fileId, idx) {
    return path.join(TMP_DIR, `${fileId}.${idx}.part`);
}
function mergeLockPath(fileId) {
    return path.join(TMP_DIR, `${fileId}.merge.lock`);
}

// Save incoming chunk stream to tmp file (atomic via temp name + rename)
async function saveChunk(fileId, index, stream) {
    const tmpFile = chunkPath(fileId, index) + '.writing';
    const finalFile = chunkPath(fileId, index);
    const writeStream = fs.createWriteStream(tmpFile, { flags: 'w' });
    await pipeline(stream, writeStream);
    // rename to final
    await fsp.rename(tmpFile, finalFile);
}

// Read or create meta
async function readMeta(fileId) {
    const p = metaPath(fileId);
    try {
        const data = await fsp.readFile(p, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { fileId, filename: null, total: null, received: [] }; // received: array of indices
    }
}
async function writeMeta(fileId, meta) {
    const p = metaPath(fileId);
    const tmp = p + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(meta), 'utf8');
    await fsp.rename(tmp, p);
}

// Merge chunks in order to target file using streaming append.
async function mergeChunks(fileId, filename, total) {
    const lock = mergeLockPath(fileId);
    // simple lock - fail if exists
    try {
        await fsp.open(lock, 'wx'); // create exclusively
    } catch (e) {
        throw new Error('merge_in_progress_or_locked');
    }

    const finalPath = path.join(UPLOAD_DIR, filename);
    try {
        // remove if exists (or you might want to keep/rename)
        try { await fsp.unlink(finalPath); } catch (_) { }

        const out = fs.createWriteStream(finalPath, { flags: 'a' });

        for (let i = 0; i < total; i++) {
            const part = chunkPath(fileId, i);
            // ensure part exists
            await fsp.access(part);
            // stream append
            await pipeline(fs.createReadStream(part), out, { end: false });
            // after streaming a chunk, continue to next (we keep the stream open not closing until done)
        }
        // close output (end)
        out.end();

        // wait for finish event
        await new Promise((resolve, reject) => {
            out.on('finish', resolve);
            out.on('error', reject);
        });

        // cleanup parts & meta
        for (let i = 0; i < total; i++) {
            const part = chunkPath(fileId, i);
            try { await fsp.unlink(part); } catch (_) { }
        }
        try { await fsp.unlink(metaPath(fileId)); } catch (_) { }
    } finally {
        try { await fsp.unlink(lock); } catch (_) { }
    }
}

async function handleUpload(req, res) {
    // expects query params or headers: fileId, index, total, filename (optional)
    const params = parseUrlParams(req.url);
    const fileId = params.fileId || req.headers['x-file-id'];
    const index = params.index !== undefined ? Number(params.index) : Number(req.headers['x-chunk-index']);
    const total = params.total !== undefined ? Number(params.total) : Number(req.headers['x-chunk-total']);
    const filename = params.filename || req.headers['x-file-name'] || `unnamed-${fileId}`;

    if (!fileId || Number.isNaN(index)) {
        return jsonRes(res, 400, { error: 'missing fileId or index' });
    }

    try {
        // save chunk
        await saveChunk(fileId, index, req);

        // update meta
        const meta = await readMeta(fileId);
        meta.filename = filename;
        meta.total = total || meta.total;
        if (!meta.received.includes(index)) {
            meta.received.push(index);
            meta.received.sort((a, b) => a - b);
        }
        await writeMeta(fileId, meta);

        return jsonRes(res, 200, { ok: true, index });
    } catch (err) {
        console.error('upload error', err);
        return jsonRes(res, 500, { error: err.message || 'upload_failed' });
    }
}

async function handleStatus(req, res) {
    const params = parseUrlParams(req.url);
    const fileId = params.fileId || req.headers['x-file-id'];
    if (!fileId) return jsonRes(res, 400, { error: 'missing fileId' });

    const meta = await readMeta(fileId);
    return jsonRes(res, 200, { fileId: meta.fileId, filename: meta.filename, total: meta.total, received: meta.received });
}

function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        req.on('data', chunk => {
            chunks.push(chunk);
        });

        req.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            resolve(body);
        });

        req.on('error', (err) => {
            reject(err);
        });
    });
}

async function handleMerge(req, res) {
    // expects JSON body or query with fileId and filename
    const params = parseUrlParams(req.url);

    const rawData = await getRequestBody(req);
    const data = JSON.parse(rawData)

    const fileId = data.fileId || req.headers['x-file-id'];
    const filename = data.filename || req.headers['x-file-name'];
    if (!fileId || !filename) return jsonRes(res, 400, { error: 'missing fileId or filename' });

    const meta = await readMeta(fileId);
    const total = meta.total || Number(data.total);
    if (!total) return jsonRes(res, 400, { error: 'missing total chunks' });

    try {
        await mergeChunks(fileId, filename, total);
        return jsonRes(res, 200, { ok: true, path: `/uploads/${filename}` });
    } catch (err) {
        console.error('merge error', err);
        return jsonRes(res, 500, { error: err.message || 'merge_failed' });
    }
}

async function handleDownload(req, res) {
    // GET /download?filename=...
    const params = parseUrlParams(req.url);
    const filename = params.filename;
    if (!filename) return jsonRes(res, 400, { error: 'missing filename' });
    const p = path.join(UPLOAD_DIR, path.basename(filename));
    try {
        await fsp.access(p);
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${path.basename(filename)}"`,
        });
        const r = fs.createReadStream(p);
        r.pipe(res);
    } catch (e) {
        jsonRes(res, 404, { error: 'not_found' });
    }
}

async function router(req, res) {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;
    try {
        if (req.method === 'POST' && pathname === '/upload') {
            return await handleUpload(req, res);
        } else if (req.method === 'GET' && pathname === '/status') {
            return await handleStatus(req, res);
        } else if (req.method === 'POST' && pathname === '/merge') {
            return await handleMerge(req, res);
        } else if (req.method === 'GET' && pathname === '/download') {
            return await handleDownload(req, res);
        } else {
            jsonRes(res, 404, { error: 'not_found' });
        }
    } catch (err) {
        console.error('router error', err);
        jsonRes(res, 500, { error: err.message || 'server_error' });
    }
}

async function start() {
    await ensureDirs();
    const server = http.createServer((req, res) => {
        router(req, res);
    });
    server.listen(PORT, () => {
        console.log(`Chunk upload server listening on http://localhost:${PORT}`);
        console.log('Endpoints: POST /upload  GET /status  POST /merge  GET /download');
    });
}

start().catch(err => {
    console.error(err);
    process.exit(1);
});
