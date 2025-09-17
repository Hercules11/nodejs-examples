// mq-client.js
const net = require('net');
const client = net.createConnection({ port: 5000 });

client.on('data', data => {
    console.log('Received from broker:', data.toString());
});

// 模拟生产消息
setInterval(() => {
    client.write('Hello MQ at ' + new Date().toISOString());
}, 2000);
