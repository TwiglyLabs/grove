'use strict';
const http = require('http');

const PORT = process.env.PORT || 8080;
const MCP_URL = process.env.MCP_URL || '';

function httpRequest(url, method) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + (parsed.search || ''),
      method: method || 'GET',
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('request timeout'));
    });
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/execute') {
    const response = { result: 'ok' };
    if (MCP_URL) {
      try {
        const mcpResp = await httpRequest(`${MCP_URL}/tools`, 'GET');
        const parsed = JSON.parse(mcpResp.body);
        response.tools = parsed.tools || [];
      } catch (_) {
        // MCP is optional — continue without tools
      }
    }
    res.writeHead(200);
    res.end(JSON.stringify(response));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`smoke-agent listening on port ${PORT}`);
});
