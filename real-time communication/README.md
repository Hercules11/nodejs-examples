运行程序


1. 启动 Node.js 服务端：node ws-server.js（默认端口 8080）。

2. 在浏览器控制台或 PowerShell 客户端连接并 join 一个房间（room），发送消息，服务器会把消息转发给同房间的其它客户端；也支持 to 字段的私聊。

3. 协议：传输 JSON 文本包，例如：
```json
{ "type": "join", "room": "room1", "name": "alice" }
{ "type": "msg", "room": "room1", "text": "hello world" }
{ "type": "msg", "to": "<clientId>", "text": "private" }
```

可扩展方向（Extensibility）
 - TLS / wss：把 http.createServer 换成 https.createServer，并在前面配置证书；或用 Nginx 做 TLS 终端（常见）。
 - 多实例 / 横向扩展：把房间/客户端状态移到 Redis（pub/sub）或 Kafka 里，节点间通过 pub/sub 转发消息，支持水平扩展。
 - 鉴权：在 upgrade 阶段用 Sec-WebSocket-Protocol 或 Cookie / Authorization 验证 token，拒绝未授权连接。
 - 协议优化：自定义二进制协议以减少带宽、增加压缩（permessage-deflate），或使用 protobuf/msgpack。
 - 持久化 & 重连：为消息写入队列（数据库/Redis stream）以便断线重连时回放未读消息。
 - 可观测性：增加 metrics（连接数、消息速率）、trace（request id）、日志等级。
 - 性能：使用 uWebSockets.js 或原生 C++ 实现的高性能服务器；或用 cluster/worker 池。