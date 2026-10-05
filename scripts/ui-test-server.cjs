const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const bridgePath = path.join(__dirname, '../tests/ui/tauri-bridge.js');
const server = http.createServer((request, response) => {
  if (request.url === '/__qa/tauri-bridge.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
    response.end(fs.readFileSync(bridgePath)); return;
  }
  const upstream = http.request({ hostname: '127.0.0.1', port: 3120, path: request.url, method: request.method, headers: { ...request.headers, host: '127.0.0.1:3120', 'accept-encoding': 'identity' } }, incoming => {
    const headers = { ...incoming.headers };
    if (!String(headers['content-type']).includes('text/html')) { response.writeHead(incoming.statusCode, headers); incoming.pipe(response); return; }
    const chunks = [];
    incoming.on('data', chunk => chunks.push(chunk));
    incoming.on('end', () => {
      const html = Buffer.concat(chunks).toString().replace('<head>', '<head><script src="/__qa/tauri-bridge.js"></script>');
      delete headers['content-length']; delete headers['content-encoding'];
      response.writeHead(incoming.statusCode, headers); response.end(html);
    });
  });
  upstream.on('error', () => { response.writeHead(502); response.end('Start the Next.js development server on port 3120 first.'); });
  request.pipe(upstream);
});
server.on('upgrade', (request, socket, head) => {
  const upstream = require('node:net').connect(3120, '127.0.0.1', () => {
    const headers = { ...request.headers, host: '127.0.0.1:3120' };
    upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream); upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
server.listen(3119, '127.0.0.1', () => console.log('Isolated UI fixture: http://127.0.0.1:3119'));
