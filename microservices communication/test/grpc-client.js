// grpc-like-client.js
const net = require('net');

function call(method, params) {
    return new Promise((resolve) => {
        const client = net.createConnection({ port: 4000 }, () => {
            client.write(JSON.stringify({ method, params }));
        });
        client.on('data', data => {
            resolve(JSON.parse(data.toString()));
            client.end();
        });
    });
}

(async () => {
    console.log(await call('sayHello', { name: 'wxc' }));
    console.log(await call('add', { a: 3, b: 5 }));
})();

// grpc 就是远程过程调用，整体的逻辑还是 处理请求返回响应。在 grpc 里面，预先定义可以进行的一些操作，数据形式，然后客户端在发送数据的时候，带上要指定的操作，还有数据。