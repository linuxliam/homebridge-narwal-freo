# Changelog

## 0.4.0

- **Vacation mode** (`vacationMode`, `vacationSwitch`): follows a switch named "Vacation Mode" on
  another bridge of the same Homebridge (a homebridge-dummy switch, for example). Once it's turned
  on, the next cleans run as usual (`vacationCleans`, default 1) and later ones started from the Home
  app are refused or run vacuum only (`vacationAfter`) until it's off.
  Needs Homebridge's insecure mode (on by default). Without such a switch, the plugin adds its own
  Vacation Mode switch to its child bridge (HomeKit side).
- The security hold setting is now **Keep security from arming Away while cleaning** (still
  `securityHold`). A hold is about keeping Away off while a robot works: Away asked for in the Home
  app meanwhile waits until the robot is done (homebridge-ecobee-security's Arm Away Now switch
  arms at once and sends it home), and Stay and Night aren't held back.
- Security hold: the security plugin can stop a robot that's out when Away is armed in a way it
  can't hold off (the ecobee app, a keypad). The plugin serves `POST /halt` on
  `<storage>/narwal/control.sock` and sends it with each hold (`&halt=`). The robot heads back to its
  base if it can be there before the exit delay ends (`&armAt=`, judged from its distance to the
  base), and pauses where it is if it can't or isn't in 10 seconds before; without `armAt` it pauses
  at once. Once it's in, or paused at the deadline, it tells the security plugin (`/release`), which
  can extend the exit delay to wait for it. A paused robot asks for a new hold when it moves again.
  Supported by homebridge-ecobee-security 0.6.0.
- Security hold: the robot now releases after every hold the security plugin accepted, not only
  when it held Stay, so the security plugin knows when it's done.
- Security hold: a robot that stops away from its base mid-job (stuck, lifted, paused…) no longer
  keeps the security system in Stay until someone frees it. The plugin now follows the robot's
  position (`map/display_map`, in 5-cm map units); once it hasn't moved or turned for **Back to Away
  when a robot stops moving for** (`securityStoppedMinutes`, default 10 minutes; 0 keeps the old
  behaviour), it
  releases its hold, and holds Stay again as soon as it moves. Time in the base (mop washes,
  recharging) doesn't count.

## 0.3.1

First public release.

- Plugin icon in the README.
