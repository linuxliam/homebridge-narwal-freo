// Client for the security hold API: ask the security system for Stay while a robot is cleaning (if it's
// armed Away), and for Away again once the job is done. Any security plugin or service can offer it:
//   POST <endpoint>/hold?by=<robot>&plugin=<package>&halt=<socket>  -> 2xx, optionally JSON { ok, held, state, reason? }
//   POST <endpoint>/release?by=<robot>&plugin=<package>  -> 2xx, optionally JSON { released, state }
// The endpoint is a Unix socket path (another Homebridge plugin; see security-providers.js) or an
// http(s) URL. A server must track holds per `by`, so one robot finishing doesn't re-arm the system
// while another is still out. `halt` is this plugin's control socket (control.js), where the server can
// stop the robot if the system is armed Away while it's out. See docs/security-hold.md.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const TIMEOUT = 15 * 1000;
const PLUGIN = 'homebridge-narwal-freo';

export class SecurityHold {
  /**
   * @param {object} opts
   * @param {string} opts.endpoint Unix socket path, or http(s) URL the paths are appended to
   * @param {string} opts.by name of the robot, shown in the security plugin's log
   * @param {string} [opts.halt] where the security plugin can ask this robot to stop (control.js)
   */
  constructor({ endpoint, by, halt }) {
    this.endpoint = endpoint;
    this.by = by;
    this.halt = halt;
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
    if (!this.endpoint) {
      return Promise.reject(new Error('no security system is chosen for the hold'));
    }
    // `plugin` lets the security side allow holds per plugin.
    const query = `?by=${encodeURIComponent(this.by)}&plugin=${PLUGIN}`
      + (path === '/hold' && this.halt ? `&halt=${encodeURIComponent(this.halt)}` : '');
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
