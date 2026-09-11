import { createServer } from 'node:http';
import { once } from 'node:events';
import { flattenNamespaceRequest, restoreNamespaceResponse } from './nanogpt-wire.mjs';

export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_BYTES = 16 * 1024 * 1024;
const OFFICIAL = 'https://api.nano-gpt.com/api/v1';

/** Candidate exec has its own network namespace and no credential environment.
 * This loopback endpoint belongs to the trusted Codex transport. */
export async function startNanoBridge({ secret, upstream = OFFICIAL, fetchImpl = fetch, onUsage = async () => {} }) {
  if (upstream !== OFFICIAL || typeof secret !== 'string' || !secret || secret.trim() !== secret) throw Error('Official NanoGPT upstream and runtime credential required');
  const server = createServer(async (request, response) => {
    const fail = (status, text) => { if (!response.headersSent) response.writeHead(status, { 'content-type': 'text/plain' }); response.end(text); };
    if (request.method !== 'POST' || request.url !== '/responses') return fail(404, 'Responses endpoint required');
    if (request.headers.authorization !== 'Bearer ' + secret) return fail(401, 'Unauthorized');
    if (Number(request.headers['content-length']) > MAX_REQUEST_BYTES) return fail(413, 'Request too large');
    const abort = new AbortController();
    response.once('close', () => { if (!response.writableEnded) abort.abort(); });
    let body, mapping;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_REQUEST_BYTES) return fail(413, 'Request too large');
        chunks.push(chunk);
      }
      ({ body, mapping } = flattenNamespaceRequest(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    } catch { return fail(400, 'Invalid Responses request'); }
    const observe = async event => {
      const value = event?.response ?? event;
      if (value?.usage) await onUsage({ at: new Date().toISOString(), responseId: value.id, model: value.model ?? body.model, usage: value.usage });
    };
    try {
      const remote = await fetchImpl(upstream + '/responses', { method: 'POST',
        headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: abort.signal,
      });
      const type = remote.headers.get('content-type') ?? 'application/json';
      if (!remote.ok) { response.writeHead(remote.status, { 'content-type': type }); return response.end(await remote.text()); }
      if (!type.includes('text/event-stream')) {
        const value = await remote.json(); await observe(value);
        response.writeHead(remote.status, { 'content-type': type });
        return response.end(JSON.stringify(restoreNamespaceResponse(value, mapping)));
      }
      response.writeHead(remote.status, { 'content-type': type, 'cache-control': 'no-cache' });
      const send = async frame => {
        const lines = frame.split(/\r?\n/), data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        let output = frame;
        if (data && data !== '[DONE]') {
          const event = JSON.parse(data); await observe(event);
          const translated = JSON.stringify(restoreNamespaceResponse(event, mapping));
          let included = false;
          output = lines.flatMap(line => {
            if (!line.startsWith('data:')) return [line];
            if (included) return []; included = true; return ['data: ' + translated];
          }).join('\n');
        }
        if (!response.write(output + '\n\n')) await once(response, 'drain', { signal: abort.signal });
      };
      const decoder = new TextDecoder(); let buffer = '';
      for await (const bytes of remote.body) {
        buffer += decoder.decode(bytes, { stream: true });
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          await send(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) throw Error('SSE event exceeds bound');
      }
      buffer += decoder.decode();
      if (buffer.trim()) await send(buffer);
      response.end();
    } catch {
      // Fetch errors may embed requests; expose no authenticated transport diagnostics.
      if (response.headersSent) response.destroy(); else fail(502, 'Provider transport interrupted');
    }
  });
  server.requestTimeout = 0;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { baseUrl: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }),
  };
}
