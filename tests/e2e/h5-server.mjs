import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as proxyRequest } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const workspace = process.cwd();
const publicRoot = resolve(workspace, 'apps/client/dist');
const port = Number(process.env.H5_PORT ?? 10086);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function proxyApi(incoming, response) {
  const upstream = proxyRequest(
    {
      hostname: '127.0.0.1',
      port: 3000,
      path: incoming.url,
      method: incoming.method,
      headers: {
        ...incoming.headers,
        host: '127.0.0.1:3000',
      },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end(`API proxy failed: ${error.message}`);
  });
  incoming.pipe(upstream);
}

function resolveStaticPath(pathname) {
  const requested = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const candidate = resolve(publicRoot, requested);
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}/`)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(publicRoot, 'index.html');
}

const server = createServer((incoming, response) => {
  const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    proxyApi(incoming, response);
    return;
  }

  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const filePath = resolveStaticPath(url.pathname);
  if (!filePath || !existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('H5 build not found. Run the client build first.');
    return;
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
  });
  if (incoming.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
});

server.listen(port, '127.0.0.1');

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
