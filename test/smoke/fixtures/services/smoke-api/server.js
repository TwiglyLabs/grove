'use strict';
const http = require('http');

const PORT = process.env.PORT || 8080;
const AUTH_URL = process.env.AUTH_URL || 'http://localhost:8080';
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8082';

function httpRequest(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + (parsed.search || ''),
      method: method || 'GET',
      headers: headers || {},
    };
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('request timeout'));
    });
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function authMiddleware(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  }
  try {
    const result = await httpRequest(
      `${AUTH_URL}/verify`,
      'POST',
      null,
      { Authorization: `Bearer ${token}` }
    );
    if (result.statusCode === 200) return true;
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  } catch (_) {
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'auth service unreachable' }));
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/data') {
    const ok = await authMiddleware(req, res);
    if (!ok) return;
    try {
      const agentResp = await httpRequest(`${AGENT_URL}/execute`, 'POST', { task: 'data' });
      res.writeHead(200);
      res.end(JSON.stringify({ data: [1, 2, 3], agent: JSON.parse(agentResp.body) }));
    } catch (_) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'agent unreachable' }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/agent/run') {
    const ok = await authMiddleware(req, res);
    if (!ok) return;
    try {
      const agentResp = await httpRequest(`${AGENT_URL}/execute`, 'POST', { task: 'run' });
      res.writeHead(agentResp.statusCode);
      res.end(agentResp.body);
    } catch (_) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'agent unreachable' }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`smoke-api listening on port ${PORT}`);
});
