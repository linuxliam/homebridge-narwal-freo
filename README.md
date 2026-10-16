<p align="center"><img src="icon.png" alt="" width="100" height="100"></p>

# homebridge-narwal-freo

Shows the original **Narwal Freo** (model YJCC012 / product group J3) in Apple Home as a
native **robot vacuum** over Matter: start, pause, resume, return to dock, clean mode
(Vacuum & Mop, Vacuum, Mop, Vacuum then Mop, Freo Mind), room selection, and battery/charging state. Optionally adds a **Cleaning** sensor for Home app automations and the
**consumables'** remaining life.

**Only the original Freo is supported.** Newer Narwal robots (Freo X, Freo Z, …) use different
message formats and won't work.

Unofficial. It talks to Narwal's cloud the same way the Narwal app does (REST sign-in at
`us-app.narwaltech.com`, then MQTT at the broker Narwal assigns). The Freo has no local API.
Message formats come from the MIT-licensed Home Assistant integrations
[mk0000001/ha-narwal-cloud](https://github.com/mk0000001/ha-narwal-cloud),
[madsah211/ha-narwal-cloud-eu](https://github.com/madsah211/ha-narwal-cloud-eu) and
[archieprichard/narwhal-cloud](https://github.com/archieprichard/narwhal-cloud), checked against our own robot.

## Requirements

- Homebridge 2.4 or newer, Node 22+.
- Matter enabled for the plugin's child bridge. "Externals only" is enough: the vacuum gets its
  own Matter pairing, and no Matter bridge is started.
- An Apple Home hub (HomePod or Apple TV) for Matter.

## Config

Set it up from the plugin's settings page in the Homebridge UI:

- **Narwal account:** sign in with the email and password you use in the Narwal app. The page checks
  them with Narwal straight away and lists the robots on the account.
- **One card per robot:** whether it shows in the Home app, its name (e.g. "Upstairs" and
  "Downstairs"), its rooms (or what to do to get them), its clean modes, the cleaning sensor and
  consumables. Each robot is its own Matter vacuum with its own pairing code.
- **Security system:** the optional security hold (see below).

The same settings in `config.json`:

```json
{
  "platform": "NarwalPlatform",
  "name": "Narwal Freo",
  "email": "you@example.com",
  "password": "…",
  "robots": [
    { "serialNumber": "YA3…", "name": "Downstairs", "cleaningSensor": true, "consumables": true },
    { "serialNumber": "YA4…", "name": "Upstairs", "cleanModes": { "both": { "task": "vacuum_then_mop" } } }
  ],
  "securityHold": true,
  "securityPlugin": "homebridge-example-security",
  "_bridge": {
    "username": "…",
    "port": 51916,
    "name": "Narwal Bridge",
    "matter": { "enabled": false, "externalsOnly": true, "disableIpv4": true }
  }
}
```

`disableIpv4` keeps Matter's mDNS off IPv4 so it doesn't compete with avahi, which advertises the
HomeKit bridges. Configs from 0.2.x (one robot's settings at the top level, no `robots`) still
work; opening the settings page moves them into `robots`.

## Clean modes in the Home app

The Home app offers three choices, **Vacuum**, **Mop** and a combined one (named after its
Automatic task), each with a "⋯" menu of **Automatic / Quick / Deep Clean**. Tapping a choice itself
picks its Automatic. What each of these nine does is set in the plugin settings (`cleanModes`):

| Home app | Automatic | Quick | Deep Clean |
|---|---|---|---|
| Vacuum | Narwal app settings | 1 pass | 2 passes |
| Mop | Narwal app settings | 1 pass | 2 passes |
| Combined | Vacuum and Mop (one pass doing both), Narwal app settings | Vacuum and Mop, 1 pass | Vacuum then Mop (a vacuum pass, then a mop pass), 2 passes each |

For each one you can set the passes (1–3), suction (quiet / standard / strong) and water level
(slightly dry / standard / slightly wet), or leave them at **Narwal app settings**: the per-room
settings saved in the Narwal app for that task. The combined ones also choose the task: Vacuum and
Mop, Vacuum then Mop, or Freo Mind (the robot decides everything). If the Narwal app
hasn't sent its settings for a task yet, standard suction and water are used and the log says so.

```json
"cleanModes": {
  "both": { "task": "freo_mind" },
  "vacuumDeep": { "passes": "2", "suction": "strong" },
  "mop": { "water": "wet" }
}
```

The vacuum must offer the clean mode it reports as current, or matter.js won't publish it, so a
mode number is never dropped without mapping it to one that stays (see `RETIRED_MODES` in
`lib/vacuum.js`). Labels must be unique too: two slots set up the same get their slot name, e.g.
"Mop, 1 pass (Quick)".

## Cleaning sensor and consumables (optional)

The Home app can't trigger automations on a robot vacuum's state, so two optional extras are
published as a regular HomeKit accessory on the same child bridge. **Pair the child bridge in the
Home app too** when you turn either on (Homebridge UI > Bridges > the plugin's bridge shows its
setup code); the vacuum keeps its own Matter pairing.

- **`cleaningSensor`:** an occupancy sensor, "Freo Cleaning", that shows Detected for the whole
  cleaning job: from the moment the robot starts until the job ends, including its trips back to
  the dock to wash the mops mid-job (the robot reports the job itself, so there's no guessing from
  dock time). Use it to trigger automations ("when Freo Cleaning detects occupancy…").
- **`consumables`:** one Filter Maintenance service per part, linked to the Cleaning sensor. **Apple's Home
  app doesn't display these** (it only shows filter life on air purifiers); use a third-party HomeKit
  app such as Eve, Controller for HomeKit or Home+, which show each part. They cover the parts the Narwal app shows a life bar for:
  Filter, Side Brush, Rolling Brushes, Mop and Filter Sponge. Each has its life left (%) and shows
  "replace" once it is at or below `replaceAtPercent` (10 by default). Read from Narwal's cloud
  hourly and after each clean. After replacing a part, reset its counter from the same app (its
  "Reset filter" control sends the Narwal app's reset command) or in the Narwal app. The
  app's "clean regularly" reminders (dust bin, base tray, sensors, caster wheel) have no counter
  and aren't shown.

## How it behaves

- **Play Sound to Locate** in the Home app plays the robot's locate sound (the Narwal app's
  "Locate robot").
- **Rooms:** the Freo only sends its saved map (room names) and the app's cleaning plans while the
  **Narwal app is open**. On first start, open the app on the Freo's map for a minute; the vacuum
  is published once the rooms arrive. Rooms and plans are cached in
  `<homebridge storage>/narwal/state.json` (mode 600, also holds the session tokens), and the
  plugin re-requests them every 6 hours, so room changes made in the app show up next time the app is open.
- **Clean settings:** each start uses the app's saved per-room template for the chosen mode, so
  suction, water level and passes follow what's set in the Narwal app.
- **No room selected** in the Home app means all rooms.
- **Freo Mind** needs the app's plan; without it the plugin refuses instead of guessing.
- **Status:** the plugin keeps the robot publishing status (the same "app open" heartbeat the
  Narwal app sends, every 5 minutes). Commands aren't acknowledged by the Freo; the state the robot
  reports a second or two later is what the Home app shows.
- **Errors** come from the robot's live status (field 1 of `robot_base_status`), so the Home app
  shows them within seconds and clears them when fixed. `lib/errors.js` maps Narwal's 225 codes
  (generated from Narwal's published error table v1.0.10) to Matter errors — water tank
  missing/empty, dirty water tank full, dust bin, stuck, wheels/brush jammed, can't find dock, low
  battery, sensor — with Narwal's message as the details. Codes not in the table are routine
  notices (e.g. 0x01010072 during mop runs) and are ignored. The cloud work status (polled every
  3 minutes) is only used when live status isn't arriving.
- **Security hold** (`securityHold`, optional): switches a security system armed **Away** to
  **Stay** while a robot cleans, so the motion sensors don't see it, and back to Away when the job is
  done. Works with any security system plugin that offers the hold (the settings page lists the
  installed ones) or anything else answering its API. See [docs/security-hold.md](docs/security-hold.md)
  for how it behaves, how to set it up, and the API for security plugin authors.
