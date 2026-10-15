// Server side of the plugin's settings page (spawned by the Homebridge UI while the settings are
// open). Checks a Narwal sign-in and lists the account's robots, and reports what the running plugin
// has saved (rooms), so the page can show where setup stands. Nothing here is kept.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { NarwalCloud } from '../lib/cloud.js';
import { DEFAULT_CLEAN_MODES } from '../lib/vacuum.js';

// Product ID of the original Freo (YJCC012), the only model this plugin supports.
const FREO_PRODUCT_ID = 'cUlfJN5JYP';

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/sign-in', async ({ email, password, region } = {}) => {
      if (!email || !password) {
        throw new RequestError('Enter your Narwal email and password.', { code: 'missing' });
      }
      const cloud = new NarwalCloud({ email: String(email).trim(), password: String(password), region, log: quiet });
      let devices;
      try {
        await cloud.login();
        devices = await cloud.getDevices();
      } catch (error) {
        throw new RequestError(error.message.replace(/^Narwal sign-in failed: /, ''), { code: 'sign_in' });
      }
      return {
        robots: devices.map(d => ({
          id: d.deviceId,
          name: d.robotName ?? 'Robot',
          serial: d.snNumber ?? d.deviceId,
          firmware: d.firmwareVersion,
          supported: d.productId === FREO_PRODUCT_ID,
        })),
      };
    });

    this.onRequest('/clean-mode-defaults', () => DEFAULT_CLEAN_MODES);

    // What the running plugin has saved: each robot's rooms, by device ID (no tokens leave this process).
    this.onRequest('/status', async () => {
      let store;
      try {
        store = JSON.parse(await readFile(join(this.homebridgeStoragePath, 'narwal', 'state.json'), 'utf8'));
      } catch {
        return { started: false, rooms: {} };
      }
      // Up to 0.2.x the plugin kept one robot's state at the top level.
      const robots = store.robots ?? (store.deviceId ? { [store.deviceId]: store } : {});
      return {
        started: true,
        rooms: Object.fromEntries(Object.entries(robots).map(([id, r]) => [id, (r.rooms ?? []).map(room => room.name)])),
      };
    });

    this.ready();
  }
}

(() => new UiServer())();
