'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-key';

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

function sign(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verify(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return false;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return sig === expected;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/login') {
    const raw = await readBody(req);
    let user = 'anonymous';
    try {
      const body = JSON.parse(raw || '{}');
      if (body.user) user = body.user;
    } catch (_) {}
    const token = sign({ sub: user, iat: Math.floor(Date.now() / 1000) });
    res.writeHead(200);
    res.end(JSON.stringify({ token }));
    return;
  }

  if (req.method === 'POST' && req.url === '/verify') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const valid = verify(token);
    res.writeHead(valid ? 200 : 401);
    res.end(JSON.stringify(valid ? { valid: true } : { error: 'invalid token' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`smoke-auth listening on port ${PORT}`);
});
