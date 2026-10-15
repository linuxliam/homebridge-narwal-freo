// Find installed Homebridge plugins that offer the security hold API. A plugin opts in with a field in
// its package.json naming its control socket, relative to the Homebridge storage folder:
//   "homebridge-security-hold": { "socket": "ecobee-security/control.sock" }

import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECURITY_HOLD_FIELD = 'homebridge-security-hold';

const OWN_NAME = 'homebridge-narwal-freo';

/** Folders plugins are installed in: the storage folder's node_modules and the one this plugin is in. */
function pluginFolders(storagePath) {
  const folders = new Set([fileURLToPath(new URL('../../', import.meta.url))]);
  if (storagePath) {
    folders.add(join(storagePath, 'node_modules'));
  }
  return [...folders];
}

function packageDirs(folder) {
  let entries;
  try {
    entries = readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    if (entry.name.startsWith('@')) {
      dirs.push(...packageDirs(join(folder, entry.name)));
    } else if (entry.name.includes('homebridge')) {
      dirs.push(join(folder, entry.name));
    }
  }
  return dirs;
}

/** Installed plugins offering the hold: `[{ name, displayName, socket }]` (socket is an absolute path). */
export function findSecurityProviders(storagePath) {
  const providers = new Map();
  for (const folder of pluginFolders(storagePath)) {
    for (const dir of packageDirs(folder)) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      const socket = pkg[SECURITY_HOLD_FIELD]?.socket;
      if (!pkg.name || pkg.name === OWN_NAME || typeof socket !== 'string' || !socket || providers.has(pkg.name)) {
        continue;
      }
      providers.set(pkg.name, {
        name: pkg.name,
        displayName: pkg.displayName || pkg.name,
        socket: isAbsolute(socket) ? socket : join(storagePath ?? '', socket),
      });
    }
  }
  return [...providers.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
