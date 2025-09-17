// ws-server.js
// Minimal pure-Node WebSocket server + simple in-memory relay (rooms, private).
// NOT production-grade — for learning and experimentation.
//
// Run: node ws-server.js

const http = require('http');
const crypto = require('crypto');

// --- Config
const PORT = 8080;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// --- In-memory storage
// clients: Map clientId => { socket: socket, rooms: Set, name }
const clients = new Map();
// rooms: Map roomName => Set of clientId
const rooms = new Map();

let nextId = 1;
function genClientId() { return 'c' + (nextId++); }

// --- Helpers: compute Sec-WebSocket-Accept
function computeAccept(key) {
    return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

// ：每个消息被封装为帧（header + payload）。客户端发来的帧被 mask（字节异或），服务器发往客户端通常不 mask。帧里有 opcode（文本 / 二进制 / ping / pong / close）和可变长度的 payload length。
// --- WebSocket frame parsing (basic, assumes single-frame text messages)
function parseFrame(buffer) {
    if (buffer.length < 2) return null;
    const first = buffer[0];
    const second = buffer[1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLen = second & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
        payloadLen = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (payloadLen === 127) {
        // Note: we assume payload fits in JS Number (not handling > 2^53-1)
        payloadLen = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
    }

    let mask;
    if (masked) {
        mask = buffer.slice(offset, offset + 4);
        offset += 4;
    }

    const payload = buffer.slice(offset, offset + payloadLen);
    if (masked) {
        for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
    }

    return { fin, opcode, payload: payload.toString('utf8'), frameLen: offset + payloadLen };
}

// --- Build a text frame to send (server -> client: no mask)
function buildTextFrame(str) {
    const payload = Buffer.from(str, 'utf8');
    const len = payload.length;
    let header;

    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        // write BigUInt64BE
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

// --- Send JSON to a client by clientId
function sendToClient(clientId, obj) {
    const client = clients.get(clientId);
    if (!client || !client.socket || client.socket.destroyed) return;
    const msg = JSON.stringify(obj);
    client.socket.write(buildTextFrame(msg));
}

// --- Broadcast to a room (except optional excludeId)
function broadcastRoom(room, obj, excludeId) {
    const s = rooms.get(room);
    if (!s) return;
    const msg = JSON.stringify(obj);
    const frame = buildTextFrame(msg);
    for (const cid of s) {
        if (cid === excludeId) continue;
        const c = clients.get(cid);
        if (c && c.socket && !c.socket.destroyed) {
            c.socket.write(frame);
        }
    }
}

// 服务器维持客户端列表与房间映射（room => set(clientId)）。收到消息后根据 room 或 to 字段决定广播或私聊。也可以将服务器做成单纯的转发器（无业务逻辑）或加入鉴权、持久化、历史回放等。
// --- Basic message handling
function handleJsonMessage(clientId, data) {
    let parsed;
    try {
        parsed = JSON.parse(data);
    } catch (e) {
        sendToClient(clientId, { type: 'error', message: 'invalid_json' });
        return;
    }

    const client = clients.get(clientId);

    if (parsed.type === 'join') {
        const room = parsed.room || 'lobby';
        client.rooms.add(room);
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(clientId);
        client.name = parsed.name || client.name || clientId;
        sendToClient(clientId, { type: 'joined', room, id: clientId });
        broadcastRoom(room, { type: 'notice', message: `${client.name} joined`, from: clientId }, clientId);
        return;
    }

    if (parsed.type === 'leave') {
        const room = parsed.room;
        if (room && rooms.has(room)) {
            rooms.get(room).delete(clientId);
            client.rooms.delete(room);
            sendToClient(clientId, { type: 'left', room });
            broadcastRoom(room, { type: 'notice', message: `${client.name} left`, from: clientId }, clientId);
        }
        return;
    }

    if (parsed.type === 'msg') {
        // private
        if (parsed.to) {
            const toId = parsed.to;
            sendToClient(toId, { type: 'msg', from: clientId, text: parsed.text, private: true });
            sendToClient(clientId, { type: 'msg', from: clientId, to: toId, text: parsed.text, private: true });
            return;
        }
        // room broadcast
        const room = parsed.room;
        if (!room) {
            sendToClient(clientId, { type: 'error', message: 'no_room' });
            return;
        }
        broadcastRoom(room, { type: 'msg', from: clientId, text: parsed.text, room }, clientId);
        return;
    }

    if (parsed.type === 'list') {
        // list room members
        const room = parsed.room || 'lobby';
        const set = rooms.get(room) || new Set();
        const members = Array.from(set).map(id => ({ id, name: clients.get(id)?.name }));
        sendToClient(clientId, { type: 'list', room, members });
        return;
    }

    sendToClient(clientId, { type: 'error', message: 'unknown_type' });
}

// --- Clean up client
function cleanupClient(clientId) {
    const client = clients.get(clientId);
    if (!client) return;
    for (const room of client.rooms) {
        const s = rooms.get(room);
        if (s) {
            s.delete(clientId);
            broadcastRoom(room, { type: 'notice', message: `${client.name} disconnected`, from: clientId }, clientId);
        }
    }
    try { client.socket.destroy(); } catch (e) { }
    clients.delete(clientId);
}

// --- HTTP server + upgrade handler
const server = http.createServer((req, res) => {
    // simple health endpoint
    if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, clients: clients.size }));
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('This is a minimal WebSocket relay server.\n');
});
// 浏览器发起 Connection: Upgrade, Upgrade: websocket，带 Sec - WebSocket - Key。服务器计算 Sec - WebSocket - Accept = base64(sha1(key + GUID)) 并返回 101 Switching Protocols，之后 TCP 连接进入 WebSocket 帧协议
server.on('upgrade', (req, socket, head) => {
    // validate Sec-WebSocket-Key
    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
    }

    const accept = computeAccept(key);
    const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`
    ];
    socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');

    // assign id and store
    const clientId = genClientId();
    const client = { socket, rooms: new Set(), name: clientId };
    clients.set(clientId, client);

    console.log(`[connect] ${clientId} from ${req.socket.remoteAddress}`);

    // raw buffer handling
    let recvBuffer = Buffer.alloc(0);


    // 服务器应支持 ping / pong 或应用层心跳，及时清理断开的客户端。示例实现了 ping -> pong 的基本回复处理（服务端在收到 ping 会回复 pong）
    socket.on('data', (buf) => {
        // accumulate buffer
        recvBuffer = Buffer.concat([recvBuffer, buf]);
        // attempt to parse frames repeatedly
        while (recvBuffer.length > 2) {
            const frame = parseFrame(recvBuffer);
            if (!frame) break;
            const { opcode, payload, frameLen } = frame;

            // remove processed bytes
            recvBuffer = recvBuffer.slice(frameLen);

            if (opcode === 0x8) { // close
                cleanupClient(clientId);
                socket.end();
                return;
            } else if (opcode === 0x9) { // ping -> reply pong
                // send pong with same payload
                const pongFrame = Buffer.concat([Buffer.from([0x8A, payload.length]), Buffer.from(payload)]);
                socket.write(pongFrame);
                continue;
            } else if (opcode === 0xA) { // pong
                // ignore for now
                continue;
            } else if (opcode === 0x1) { // text
                handleJsonMessage(clientId, payload);
            } else {
                // other opcode
            }
        }
    });

    socket.on('close', () => {
        console.log(`[close] ${clientId}`);
        cleanupClient(clientId);
    });

    socket.on('error', (err) => {
        console.log(`[error] ${clientId} ${err && err.message}`);
        cleanupClient(clientId);
    });

    // Optionally send a welcome message
    sendToClient(clientId, { type: 'welcome', id: clientId, message: 'welcome to minimal-ws-relay' });
});

server.listen(PORT, () => {
    console.log(`WebSocket relay server running on ws://localhost:${PORT}`);
});
