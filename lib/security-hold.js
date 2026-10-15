// Client for homebridge-ecobee-security's control socket: ask for Stay while the robot is out
// (if the system is armed Away), and for Away again once it's back on the dock.

import { request } from 'node:http';

const TIMEOUT = 15 * 1000;

export class SecurityHold {
  /**
   * @param {object} opts
   * @param {string} opts.socketPath
   * @param {string} opts.by name shown in the security plugin's log
   */
  constructor({ socketPath, by }) {
    this.socketPath = socketPath;
    this.by = by;
  }

  /** Resolves `{ ok, held, state, reason? }`; rejects if the security plugin can't be reached. */
  hold() {
    return this.call('/hold');
  }

  /** Resolves `{ released, state }`. */
  release() {
    return this.call('/release');
  }

  call(path) {
    return new Promise((resolve, reject) => {
      const req = request({
        socketPath: this.socketPath,
        path: `${path}?by=${encodeURIComponent(this.by)}`,
        method: 'POST',
        timeout: TIMEOUT,
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(body);
          } catch {
            return reject(new Error(`bad reply from the security plugin (${res.statusCode})`));
          }
          if (res.statusCode !== 200) {
            return reject(new Error(json.error ?? `security plugin error ${res.statusCode}`));
          }
          resolve(json);
        });
      });
      req.on('timeout', () => req.destroy(new Error('the security plugin did not answer')));
      req.on('error', error => reject(error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
        ? new Error('the ecobee security plugin is not running') : error));
      req.end();
    });
  }
}
