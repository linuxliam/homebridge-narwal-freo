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

```json
{
  "platform": "NarwalPlatform",
  "name": "Freo",
  "email": "you@example.com",
  "password": "…",
  "defaultCleanMode": "both",
  "cleaningSensor": true,
  "consumables": true,
  "_bridge": {
    "username": "…",
    "port": 51916,
    "name": "Narwal Bridge",
    "matter": { "enabled": false, "externalsOnly": true, "disableIpv4": true }
  }
}
```

`disableIpv4` keeps Matter's mDNS off IPv4 so it doesn't compete with avahi, which advertises the
HomeKit bridges.

## Clean modes in the Home app

The Home app shows three buttons, **Vacuum**, **Mop** and a combined **Vacuum + Mop** one (it
names that button after the task chosen for it), each with a "⋯" menu of Automatic / Quick / Deep
Clean. What each of these does is set in the plugin settings (`cleanModes`):

| Home app | Default |
|---|---|
| Vacuum (button = Automatic) | Vacuum, Narwal app settings |
| Vacuum: Quick / Deep Clean | 1 pass / 2 passes |
| Mop (button = Automatic) | Mop, Narwal app settings |
| Mop: Quick / Deep Clean | 1 pass / 2 passes |
| Vacuum + Mop (button) | Vacuum and Mop (vacuums and mops in one pass), Narwal app settings |
| Vacuum + Mop: Quick | Vacuum and Mop, 1 pass |
| Vacuum + Mop: Deep Clean | Vacuum then Mop (a vacuum pass, then a mop pass), 2 passes each |
| Vacuum + Mop: Automatic | Freo Mind |

For each one you can set the passes (1–3), suction (quiet / standard / strong) and water level
(slightly dry / standard / slightly wet), or leave them at **Narwal app settings**: the per-room
settings saved in the Narwal app for that task. The combined slots also choose the task: Vacuum and
Mop, Vacuum then Mop, or Freo Mind (which always uses the robot's own settings). If the Narwal app
hasn't sent its settings for a task yet, standard suction and water are used and the log says so.

```json
"cleanModes": {
  "both": { "task": "vacuum_then_mop" },
  "vacuumDeep": { "passes": "2", "suction": "strong" },
  "mop": { "water": "wet" }
}
```

Matter saves the vacuum's current clean mode, and matter.js refuses to start the vacuum if that
mode number is no longer offered, so the ten slots and their numbers never change, only what they
do (see `RETIRED_MODES` in `lib/vacuum.js`).

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
- **Security hold** (`securityHold`, optional; needs homebridge-ecobee-security 0.2.0+ on the same
  Homebridge): before a start or resume, if ecobee Smart Security is armed **Away** (or arming Away)
  the plugin has it switched to **Stay**, so the motion sensors don't see the robot. When the cleaning
  job ends it is armed Away again, with the normal exit delay (mop-wash visits to the dock mid-job
  don't count as the end). If anyone changes the
  security system in between (disarm on arriving home, etc.), it's left alone. If the security
  plugin can't be reached or the alarm is triggered, the start is **refused** (the Home app shows
  an error) rather than risking a false alarm. Cleans started from the Narwal app are caught when
  the robot reports the job, a few seconds after it starts. Talks to the security plugin over
  its Unix socket `<homebridge storage>/ecobee-security/control.sock`.
