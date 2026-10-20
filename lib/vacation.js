// Vacation mode: follow a switch on another bridge of this Homebridge (e.g. a homebridge-dummy
// switch named "Vacation Mode"). Child bridges run in their own processes, so the switch is read
// over HAP on 127.0.0.1, which Homebridge allows with just the bridge's PIN in insecure mode
// (the Homebridge UI's accessory control uses the same).

import { readFileSync } from 'node:fs';

const POLL = 30 * 1000;
const RESCAN = 10 * 60 * 1000;
// Other child bridges may still be starting: keep looking every poll this long before giving up.
const GRACE = 3 * 60 * 1000;
const TIMEOUT = 5000;

const INFO = '3E';
const SWITCH = '49';
const ON = '25';
const NAME = '23';
const CONFIGURED_NAME = 'E3';

/** Apple's HAP types come as "49" or "00000049-0000-1000-8000-0026BB765291". */
function shortType(type) {
  const t = String(type).toUpperCase();
  if (t.includes('-') && !t.endsWith('-0000-1000-8000-0026BB765291')) {
    return t;
  }
  return t.split('-')[0].replace(/^0+/, '');
}

function normalize(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export class VacationSwitch {
  /**
   * @param {object} opts
   * @param {string} opts.configPath Homebridge's config.json (bridge ports and PINs)
   * @param {string} opts.name the switch name to look for
   * @param {(on: boolean) => void} opts.onChange called with the switch state on the first read and on every change
   * @param {() => void} [opts.onMissing] no such switch on any bridge (after the start-up grace period)
   * @param {(bridge: string) => void} [opts.onFound] the switch was found (before its first onChange)
   * @param {(bridge: string) => void} [opts.onBack] the switch is reachable again after it was lost (even on the same bridge)
   * @param {string} [opts.bridge] only look on the bridge with this name (the one it was found on before)
   */
  constructor({ configPath, name, log, onChange, onMissing, onFound, onBack, bridge }) {
    this.configPath = configPath;
    this.name = name;
    this.wanted = normalize(name);
    this.log = log;
    this.onChange = onChange;
    this.onMissing = onMissing;
    this.onFound = onFound;
    this.onBack = onBack;
    this.onlyBridge = bridge;
    this.found = undefined;
    this.state = undefined;
    this.warned = new Set();
  }

  start() {
    this.startedAt = Date.now();
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Every bridge in config.json with a fixed port: the main bridge and the child bridges. */
  bridges() {
    const config = JSON.parse(readFileSync(this.configPath, 'utf8'));
    const main = config.bridge ?? {};
    const list = [{ name: main.name ?? 'Homebridge', port: main.port, pin: main.pin }];
    for (const block of [...(config.platforms ?? []), ...(config.accessories ?? [])]) {
      const child = block?._bridge;
      if (child?.port && block.platform !== 'NarwalPlatform') {
        list.push({ name: child.name ?? block.platform ?? block.accessory, port: child.port, pin: child.pin ?? main.pin });
      }
    }
    return list.filter(b => b.port && b.pin && (!this.onlyBridge || b.name === this.onlyBridge));
  }

  async request(bridge, path) {
    const response = await fetch(`http://127.0.0.1:${bridge.port}${path}`, {
      headers: { Authorization: bridge.pin },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (response.status === 401 || response.status === 470) {
      const error = new Error('not allowed');
      error.auth = true;
      throw error;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  /** Look through every bridge for a switch with the wanted name. */
  async scan() {
    this.scannedAt = Date.now();
    let bridges;
    try {
      bridges = this.bridges();
    } catch (error) {
      this.warnOnce('config', `Vacation mode: could not read the Homebridge config (${error.message}).`);
      return undefined;
    }
    let denied = 0;
    for (const bridge of bridges) {
      let data;
      try {
        data = await this.request(bridge, '/accessories');
      } catch (error) {
        denied += error.auth ? 1 : 0;
        continue;
      }
      for (const accessory of data.accessories ?? []) {
        const services = accessory.services ?? [];
        const switches = services.filter(s => shortType(s.type) === SWITCH);
        const info = services.find(s => shortType(s.type) === INFO);
        for (const service of switches) {
          const chars = service.characteristics ?? [];
          // A lone switch is often named only on its accessory (homebridge-dummy does this).
          const named = [...chars, ...(switches.length === 1 ? info?.characteristics ?? [] : [])];
          const names = named.filter(c => [NAME, CONFIGURED_NAME].includes(shortType(c.type))).map(c => normalize(c.value));
          const on = chars.find(c => shortType(c.type) === ON);
          if (on && names.includes(this.wanted)) {
            return { bridge, aid: accessory.aid, iid: on.iid, value: on.value };
          }
        }
      }
    }
    if (denied && denied === bridges.length) {
      this.warnOnce('denied', 'Vacation mode: Homebridge didn\'t let the plugin read other bridges. Turn on insecure mode '
        + '(Homebridge Settings > Homebridge Insecure Mode / Accessory Control) and restart Homebridge.');
    } else if (!this.onMissing && !this.starting()) {
      this.warnOnce('missing', `Vacation mode: no switch named "${this.name}" found on this Homebridge. Add one (for example `
        + 'with homebridge-dummy) or change the name in the plugin settings; checking again every 10 minutes.');
    }
    return undefined;
  }

  async read() {
    if (this.found) {
      try {
        const { bridge, aid, iid } = this.found;
        const data = await this.request(bridge, `/characteristics?id=${aid}.${iid}`);
        const value = data.characteristics?.[0]?.value;
        if (value !== undefined) {
          return Boolean(value);
        }
      } catch {
        // Bridge restarting or the switch moved: look again.
      }
      this.found = undefined;
      this.lost = true;
    }
    // Not found last time: don't read every bridge every 30 s (except while bridges are starting, or
    // when the switch's bridge is known: that's one local request).
    if (this.missing && !this.onlyBridge && !this.starting() && Date.now() - this.scannedAt < RESCAN) {
      this.onMissing?.();
      return undefined;
    }
    const found = await this.scan();
    this.missing = !found;
    if (!found) {
      if (!this.starting()) {
        this.onMissing?.();
      }
      return undefined;
    }
    if (this.foundOn !== found.bridge.port) {
      this.log.info(`Vacation mode: following "${this.name}" on ${found.bridge.name}.`);
      this.foundOn = found.bridge.port;
      this.onFound?.(found.bridge.name);
      // Stay with this bridge: a same-named switch elsewhere doesn't take over while it's down.
      this.onlyBridge = found.bridge.name;
    } else if (this.lost) {
      this.onBack?.(found.bridge.name);
    }
    this.lost = false;
    this.warned.clear();
    this.found = found;
    return Boolean(found.value);
  }

  async poll() {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const on = await this.read();
      // Unknown (bridge down, switch missing): keep the last state.
      if (on !== undefined && on !== this.state) {
        this.state = on;
        this.onChange(on);
      }
    } finally {
      this.polling = false;
    }
  }

  /** Within the start-up grace period, when other bridges may not be up yet. */
  starting() {
    return Date.now() - this.startedAt < GRACE;
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.log.warn(message);
    }
  }
}
