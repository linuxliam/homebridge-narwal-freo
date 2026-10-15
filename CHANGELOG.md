# Changelog

## 0.3.0

- `cleanModes`: choose what each Home app clean mode does: passes, suction and water level for
  every Vacuum / Mop / Vacuum + Mop slot, and the task (Vacuum and Mop, Vacuum then Mop, Freo Mind)
  for the combined ones. The settings page groups them per Home app button.
- Narwal's one-pass **Vacuum and Mop** is now offered and is the default for the combined button
  and its Quick mode; Deep Clean stays Vacuum then Mop with 2 passes each, Automatic stays Freo Mind.
- `defaultCleanMode` now names a slot (`both`, `vacuumQuick`, …); the old values still work.

## 0.2.0

- Renamed to `homebridge-narwal-freo`: only the original Narwal Freo (YJCC012) is supported.
- `cleaningSensor`: an occupancy sensor that's Detected while the robot is away from the dock, for
  Home app automations (the Home app can't trigger on a robot vacuum).
- `consumables`: remaining life of the filter, side brush, rolling brushes, mops and filter sponge
  as Filter Maintenance services, with "replace" at `replaceAtPercent`. Shown by apps such as Eve
  and Controller; Apple's Home app doesn't display them.
- `dockedMinutes` replaces `securityReleaseMinutes` (still read if set) and is shared by the
  cleaning sensor and the security hold.

## 0.1.9

- `securityHold`: switch homebridge-ecobee-security from Away to Stay while the robot cleans.

## 0.1.8

- First version used day to day: Matter robot vacuum with rooms, clean modes, start / pause /
  return to dock, live errors and Siri.
