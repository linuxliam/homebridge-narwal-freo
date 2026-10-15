# Changelog

## 0.3.0

- New settings page, laid out like homebridge-ecobee-security's: sign in to Narwal (checked straight
  away, shows the robot), the room list or what to do to get it, and the clean modes as one table.
- `cleanModes`: choose what each Home app clean mode does: passes, suction and water level for
  every Vacuum / Mop / Vacuum + Mop slot, and the task (Vacuum and Mop, Vacuum then Mop, Freo Mind)
  for the combined ones. The settings page groups them per Home app button.
- Narwal's one-pass **Vacuum and Mop** is now offered and is the default for the combined button
  and its Quick mode; Deep Clean stays Vacuum then Mop with 2 passes each, Automatic stays Freo Mind.
- `defaultCleanMode` now names a slot (`both`, `vacuumQuick`, …); the old values still work.
- The robot's own job state drives the cleaning sensor and the security hold: they follow the
  whole job, mop-wash visits to the dock included, and end the moment it does. `dockedMinutes` is
  gone.
- An idle robot on the dock showed as Stopped instead of Docked.
- The battery level (and state) could stay at the start-up placeholder of 100% until it next
  changed: statuses received before the vacuum was published were never sent.
- The Home app's **Play Sound to Locate** now plays the robot's locate sound.
- Consumables: resetting a part's filter indication (Eve and similar apps) resets its counter on
  the robot, like the Narwal app's reset button.

## 0.2.0

- Renamed to `homebridge-narwal-freo`: only the original Narwal Freo (YJCC012) is supported.
- `cleaningSensor`: an occupancy sensor that's Detected while the robot is away from the dock, for
  Home app automations (the Home app can't trigger on a robot vacuum).
- `consumables`: remaining life of the filter, side brush, rolling brushes, mops and filter sponge
  as Filter Maintenance services, with "replace" at `replaceAtPercent`. Shown by apps such as Eve
  and Controller; Apple's Home app doesn't display them.
- `dockedMinutes` (replacing `securityReleaseMinutes`): how long the robot must stay on the dock
  before the cleaning sensor and the security hold treat cleaning as finished.

## 0.1.9

- `securityHold`: switch homebridge-ecobee-security from Away to Stay while the robot cleans.

## 0.1.8

- First version used day to day: Matter robot vacuum with rooms, clean modes, start / pause /
  return to dock, live errors and Siri.
