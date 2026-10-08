import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';

interface FetchApplication { fetch(request: Request): Promise<Response> }

/** Keep Node ingress streaming so application admission/authentication and body limits run first. */
export function createNodeHandler(application: FetchApplication, options: { publicUrl?: string } = {}) {
  return async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    const abort = new AbortController();
    const onAborted = () => abort.abort();
    const onClosed = () => { if (!outgoing.writableEnded) abort.abort(); };
    incoming.once('aborted', onAborted);
    outgoing.once('close', onClosed);
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
      }
      const method = incoming.method ?? 'GET';
      const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: abort.signal };
      if (method !== 'GET' && method !== 'HEAD') {
        // Bound the bridge queue by bytes, not by number of chunks. No eager full-body copy.
        init.body = Readable.toWeb(incoming, { strategy: { highWaterMark: 16_384, size: chunk => chunk.byteLength } }) as ReadableStream<Uint8Array>;
        init.duplex = 'half';
      }
      // TLS terminates at the configured proxy. Only server-owned configuration
      // chooses the scheme; forwarded headers never select an auth origin.
      const protocol = options.publicUrl ? new URL(options.publicUrl).protocol : 'http:';
      const request = new Request(`${protocol}//${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, init);
      const response = await application.fetch(request);
      if (outgoing.destroyed) return;
      // Refused/oversized uploads are not drained or reused. Flush the response, then close.
      if (!incoming.complete) outgoing.shouldKeepAlive = false;
      const responseHeaders: Record<string,string|string[]> = Object.fromEntries(response.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) responseHeaders['set-cookie'] = cookies;
      outgoing.writeHead(response.status, responseHeaders);
      if (response.body && method !== 'HEAD') {
        for await (const chunk of response.body) {
          if (outgoing.destroyed) break;
          if (!outgoing.write(chunk)) await once(outgoing, 'drain', { signal: abort.signal });
        }
      }
      outgoing.end();
    } catch {
      if (!outgoing.headersSent && !outgoing.destroyed) {
        outgoing.shouldKeepAlive = false;
        outgoing.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        outgoing.end('{"error":"Request could not be processed."}');
      } else if (!outgoing.destroyed) outgoing.destroy();
    } finally {
      incoming.removeListener('aborted', onAborted);
      outgoing.removeListener('close', onClosed);
    }
  };
}
