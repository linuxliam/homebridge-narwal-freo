// Client for the security hold API: ask the security system for Stay while a robot is cleaning (if it's
// armed Away), and for Away again once the job is done. Any security plugin or service can offer it:
//   POST <endpoint>/hold?by=<robot>     -> 2xx, optionally JSON { ok, held, state, reason? }
//   POST <endpoint>/release?by=<robot>  -> 2xx, optionally JSON { released, state }
// The endpoint is a Unix socket path (another Homebridge plugin, e.g. homebridge-ecobee-security) or
// an http(s) URL. A server must track holds per `by`, so one robot finishing doesn't re-arm the system
// while another is still out. See "Security hold API" in the README.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const TIMEOUT = 15 * 1000;

export class SecurityHold {
  /**
   * @param {object} opts
   * @param {string} opts.endpoint Unix socket path, or http(s) URL the paths are appended to
   * @param {string} opts.by name of the robot, shown in the security plugin's log
   */
  constructor({ endpoint, by }) {
    this.endpoint = endpoint;
    this.by = by;
  }

  /** Resolves `{ ok, held, state?, reason? }`; rejects if the security system can't be reached. */
  async hold() {
    const reply = await this.call('/hold');
    return { ok: reply.ok ?? true, held: reply.held ?? reply.ok ?? true, state: reply.state, reason: reply.reason };
  }

  /** Resolves `{ released, state? }`. */
  async release() {
    const reply = await this.call('/release');
    return { released: reply.released ?? true, state: reply.state };
  }

  call(path) {
    const query = `?by=${encodeURIComponent(this.by)}`;
    const options = { method: 'POST', timeout: TIMEOUT };
    let request = httpRequest;
    if (/^https?:\/\//i.test(this.endpoint)) {
      const url = new URL(this.endpoint);
      Object.assign(options, {
        protocol: url.protocol, hostname: url.hostname, port: url.port || undefined,
        auth: url.username ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` : undefined,
        path: `${url.pathname.replace(/\/$/, '')}${path}${query}`,
      });
      request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    } else {
      Object.assign(options, { socketPath: this.endpoint, path: `${path}${query}` });
    }
    return new Promise((resolve, reject) => {
      const req = request(options, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          let json = {};
          try {
            json = body.trim() ? JSON.parse(body) : {};
          } catch {
            // A plain webhook may answer with text; the status code is what counts.
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(json.error ?? `security system answered ${res.statusCode}`));
          }
          resolve(json);
        });
      });
      req.on('timeout', () => req.destroy(new Error('the security system did not answer')));
      req.on('error', error => reject(error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
        ? new Error('the security plugin is not running') : error));
      req.end();
    });
  }
}
