// 在浏览器控制台（Chrome / Edge）执行
// 打开多个浏览器标签页并改名字，可以看到房间广播效果。
const ws = new WebSocket('ws://localhost:8080');


ws.onopen = () => {
    console.log('open');
    ws.send(JSON.stringify({ type: 'join', room: 'room1', name: 'alice' }));
    // send message after join
    setTimeout(() => ws.send(JSON.stringify({ type: 'msg', room: 'room1', text: 'hello from browser' })), 200);
};

ws.onmessage = (ev) => console.log('recv', ev.data);
ws.onclose = () => console.log('closed');
ws.onerror = (e) => console.error('err', e);
