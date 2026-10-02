/** In-cell half of the Claude egress path (docs/isolated-probe-host.md § Claude cells).
 *
 * The CLI only speaks HTTPS_PROXY over TCP, but the cell's network namespace has nothing
 * but loopback. This relays 127.0.0.1:$BENCH_BRIDGE_PORT to the host proxy's unix socket,
 * which is the one path out of the namespace. It prints nothing: the unit's stdout is the
 * candidate's stream-json and must stay byte-clean.
 */
import net from 'node:net';

const port = Number(process.env.BENCH_BRIDGE_PORT);
const socketPath = process.env.BENCH_BRIDGE_SOCKET;
if (!Number.isInteger(port) || !socketPath) process.exit(2);

net.createServer((client) => {
  const upstream = net.connect(socketPath);
  const close = () => { client.destroy(); upstream.destroy(); };
  for (const side of [client, upstream]) {
    side.on('error', close);
    side.on('close', close);
  }
  client.pipe(upstream).pipe(client);
}).listen(port, '127.0.0.1');
