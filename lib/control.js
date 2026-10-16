// A Unix socket in the plugin's storage folder (mode 600) where the security plugin can stop a robot
// that's out cleaning, because the system is being armed Away anyway:
//   POST /halt?by=<robot name>&armAt=<ISO time>  -> { halted, returning?, reason? }   (no `by`: every robot)
// `armAt` (optional): when the motion sensors arm. The robot heads back to its base if it can make it
// in time (`returning: true`), and pauses where it is if it isn't in shortly before. Without it: pause now.
// Its path goes to the security plugin with each hold request (`&halt=`); see security-hold.js.

import { chmodSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';

export function startControlServer({ path, log, findUnits }) {
  try {
    rmSync(path, { force: true });
  } catch (error) {
    log.warn(`Could not remove an old control socket ${path}: ${error.message}`);
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const reply = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || url.pathname !== '/halt') {
      return reply(404, { error: 'POST /halt' });
    }
    const units = findUnits(url.searchParams.get('by') || undefined);
    if (!units.length) {
      return reply(404, { halted: false, reason: 'no robot by that name' });
    }
    const armAt = Date.parse(url.searchParams.get('armAt') ?? '');
    const results = await Promise.all(units.map(u => u.vacuum.halt(armAt).catch(error => ({ halted: false, reason: error.message }))));
    const halted = results.some(r => r.halted);
    const returning = results.some(r => r.returning) || undefined;
    reply(200, { halted, returning, reason: halted ? undefined : results.map(r => r.reason).filter(Boolean).join('; ') || undefined });
  });
  server.on('error', error => log.error(`Control socket ${path}: ${error.message}`));
  server.listen(path, () => {
    try {
      chmodSync(path, 0o600);
    } catch (error) {
      log.error(`Control socket ${path}: ${error.message}; closing it.`);
      server.close();
    }
  });
  return server;
}
