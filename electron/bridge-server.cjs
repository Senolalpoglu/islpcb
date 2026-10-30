// The local HTTP bridge between the MCP server (started by Claude Desktop) and the running program.
//
// It listens on 127.0.0.1 only, wants a secret token on every request, and refuses requests that come from a web
// page (an Origin header) or carry another Host name, so a website cannot drive the program through the browser.

const http = require('http');
const crypto = require('crypto');

const MAX_BODY = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * `forward(tool, input)` runs one tool and resolves to { text, image? }; `info()` describes the tools on offer.
 * Returns an http.Server that is not listening yet.
 */
function createBridge({ token, info, forward }) {
  const want = Buffer.from(token);
  return http.createServer(async (req, res) => {
    const send = (code, body) => {
      const text = JSON.stringify(body);
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    };
    try {
      if (req.headers.origin) return send(403, { error: 'Requests from web pages are refused.' });
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') return send(403, { error: 'Wrong host.' });
      const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return send(401, { error: 'Unauthorized.' });

      if (req.method === 'GET' && req.url === '/info') return send(200, info());
      if (req.method === 'POST' && req.url === '/call') {
        const body = JSON.parse(await readBody(req));
        if (typeof body.tool !== 'string') return send(400, { error: 'Missing "tool".' });
        const input = typeof body.input === 'object' && body.input !== null ? body.input : {};
        return send(200, await forward(body.tool, input));
      }
      return send(404, { error: 'Not found.' });
    } catch (e) {
      return send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

module.exports = { createBridge };
