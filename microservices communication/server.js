const http = require('http');
const net = require('net');

// ---------------- REST 部分 ----------------
const restServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/hello') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Hello from REST' }));
    } else if (req.method === 'POST' && req.url === '/echo') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ youSent: JSON.parse(body || '{}') }));
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});
restServer.listen(3000, () => console.log('REST server: http://localhost:3000'));

// ---------------- gRPC-like 部分 ----------------
const methods = {
    sayHello: (params) => ({ message: `Hello, ${params.name}` }),
    add: (params) => ({ result: params.a + params.b }),
};

const grpcServer = net.createServer(socket => {
    socket.on('data', data => {
        try {
            const req = JSON.parse(data.toString());
            const fn = methods[req.method];
            let res;
            if (fn) {
                res = { success: true, data: fn(req.params) };
            } else {
                res = { success: false, error: 'Method not found' };
            }
            socket.write(JSON.stringify(res) + "\n");
        } catch (e) {
            socket.write(JSON.stringify({ success: false, error: e.message }) + "\n");
        }
    });
});
grpcServer.listen(4000, () => console.log('gRPC-like server: tcp://localhost:4000'));

// ---------------- MQ 部分 ----------------
const mqClients = [];
const mqServer = net.createServer(socket => {
    mqClients.push(socket);

    socket.on('data', data => {
        const msg = data.toString();
        console.log('Broker received:', msg);
        mqClients.forEach(c => {
            // 多个 client 连接时，发送的消息会广播给所有订阅者
            if (c !== socket) c.write(msg); // 接收到信息，把消息传给其他 socket
        });
    });

    socket.on('end', () => {
        const idx = mqClients.indexOf(socket);
        if (idx >= 0) mqClients.splice(idx, 1); // 接收信息完成，把自己清除出队列
    });
});
mqServer.listen(5000, () => console.log('MQ broker: tcp://localhost:5000'));
