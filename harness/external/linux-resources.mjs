import { readFile, statfs } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

const MIB = 1024 * 1024;

function counter(value, name) {
  const parsed = Number(value);
  if (value === undefined || !Number.isSafeInteger(parsed) || parsed < 0) throw Error(`Invalid Linux resource counter: ${name}`);
  return parsed;
}

async function counters() {
  const [stat, vmstat] = await Promise.all([readFile('/proc/stat', 'utf8'), readFile('/proc/vmstat', 'utf8')]);
  const fields = stat.match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/);
  if (!fields || fields.length < 8) throw Error('Linux aggregate CPU counters unavailable');
  // guest and guest_nice are already included in user/nice; count the first eight only.
  const cpu = fields.slice(0, 8).map((value, index) => counter(value, `cpu[${index}]`));
  return {
    cpuTotal: cpu.reduce((sum, value) => sum + value, 0),
    cpuIdle: cpu[3] + cpu[4],
    swapOut: counter(vmstat.match(/^pswpout\s+(\d+)$/m)?.[1], 'pswpout'),
    monotonicMs: performance.now(),
  };
}

async function freeMiB(directory) {
  const value = await statfs(directory, { bigint: true });
  // bavail reflects space available to this unprivileged benchmark worker.
  const bytes = value.bavail * value.bsize;
  if (bytes < 0n || bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Invalid filesystem free-space counter');
  return Number(bytes) / MIB;
}

/** Host-wide samples, not per-worker attribution. Cached timestamps identify repeated readings. */
export async function createLinuxResourceSampler({ minimumIntervalMs = 5000, workspace = process.cwd() } = {}) {
  if (process.platform !== 'linux') throw Error('Linux resource sampling requires Linux');
  if (!Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 1) throw Error('Positive minimum resource interval required');
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw Error('Absolute workspace path required');
  let previous = await counters(), cached, pending;

  const measure = async () => {
    // The first caller also gets a real CPU interval, never a fabricated zero/100 reading.
    const remaining = minimumIntervalMs - (performance.now() - previous.monotonicMs);
    if (remaining > 0) await delay(remaining);
    const [current, meminfo, tmpFreeMiB, workspaceFreeMiB, rootFreeMiB] = await Promise.all([
      counters(), readFile('/proc/meminfo', 'utf8'), freeMiB('/tmp'), freeMiB(workspace), freeMiB('/'),
    ]);
    const totalDelta = current.cpuTotal - previous.cpuTotal;
    const idleDelta = current.cpuIdle - previous.cpuIdle;
    const swapOutDelta = current.swapOut - previous.swapOut;
    if (totalDelta <= 0 || swapOutDelta < 0) throw Error('Linux resource counters reset or did not advance');
    // Linux iowait can decrease; preserve the raw delta and bound the utilization estimate.
    const cpuPercent = 100 * (1 - Math.max(0, Math.min(totalDelta, idleDelta)) / totalDelta);
    cached = Object.freeze({
      timestamp: new Date().toISOString(), cpuPercent,
      availableMiB: counter(meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m)?.[1], 'MemAvailable') / 1024,
      swapOutDelta, tmpFreeMiB, workspaceFreeMiB, rootFreeMiB,
      intervalMs: current.monotonicMs - previous.monotonicMs,
      cpuTotalDelta: totalDelta, cpuIdleDelta: idleDelta,
      cpuTotal: current.cpuTotal, cpuIdle: current.cpuIdle, swapOut: current.swapOut,
    });
    previous = current;
    return cached;
  };

  return async function sample() {
    if (pending) return pending;
    if (cached && performance.now() - previous.monotonicMs < minimumIntervalMs) return cached;
    // Concurrent callers share one counter transition, so none consumes another's interval.
    pending = measure();
    try { return await pending; } finally { pending = undefined; }
  };
}
