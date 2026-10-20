# Changelog

## 0.4.2

- The log now shows a short report when each clean ends: why it ended (finished, stopped,
  battery too low, …), how much was done, the area and the time.
- Settings page: Vacation mode now comes before Security hold (renamed from Security system).
- The vacation switch name is no longer a setting: it's always "Vacation Mode". An existing setting
  keeps working.
- Vacation mode: after the vacation switch's bridge restarts, the switch is found again within
  30 seconds (it could take up to 10 minutes), and the log says it's back.
- README: header and device images, and badges.

## 0.4.1

- Security hold: a clean started outside the Home app (Narwal app, its schedule, the robot's button), or a
  stopped robot that starts moving again, is checked with the security system as soon as the robot
  leaves its base (or moves). With the OK it carries on; if the security system can't be reached or
  says no, the robot is paused and stays paused (resume it from the Home app). Before, a failed check
  was only logged and the robot kept going.
- Fixed: the robot showed as docked after being taken off its base (to empty the dustbin), and
  Return to dock did nothing. A robot that reports being out of its base now shows as stopped, and
  Return to dock checks the robot's current status instead of the tile.
- Return to dock asks for the security hold before the robot sets off, like a clean, unless the
  robot's hold is still in force (a clean that got the OK and hasn't released it; a stuck robot's
  hold is released after it stands still): the trip home passes the motion sensors, so if the
  security system can't be reached (or says no) the robot stays where it is. A trip home ordered by
  the security plugin itself (Away being armed) doesn't ask either. It was logged as "Cleaning started outside the Home app".
- Cleans started outside the Home app are only checked once the robot leaves its base, not for what
  it reports while in it (the end of a trip home looked like a start).
- Fixed false "Battery: sent …% but the vacuum reports …%" warnings: the check read the value back
  before Homebridge had applied it (the Home app always got the right level). It now waits for it.
- After Return to dock the plugin checks that the robot set off; a robot with an error to clear
  (a jammed brush, say) can ignore it, and the log now says so instead of the tile showing it on
  its way home.

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
  arms at once and sends it home), and Home and Night aren't held back.
- Security hold: the security plugin can stop a robot that's out when Away is armed in a way it
  can't hold off (the ecobee app, a keypad). The plugin serves `POST /halt` on
  `<storage>/narwal/control.sock` and sends it with each hold (`&halt=`). The robot heads back to its
  base if it can be there before the exit delay ends (`&armAt=`, judged from its distance to the
  base), and pauses where it is if it can't or isn't in 10 seconds before; without `armAt` it pauses
  at once. Once it's in, or paused at the deadline, it tells the security plugin (`/release`), which
  can extend the exit delay to wait for it. A paused robot asks for a new hold when it moves again.
  Supported by homebridge-ecobee-security 0.6.0.
- Security hold: the robot now releases after every hold the security plugin accepted, not only
  when it switched to Home, so the security plugin knows when it's done.
- Security hold: a robot that stops away from its base mid-job (stuck, lifted, paused…) no longer
  keeps the security system in Home until someone frees it. The plugin now follows the robot's
  position (`map/display_map`, in 5-cm map units); once it hasn't moved or turned for **Back to Away
  when a robot stops moving for** (`securityStoppedMinutes`, default 10 minutes; 0 keeps the old
  behaviour), it
  releases its hold, and switches it to Home again as soon as it moves. Time in the base (mop washes,
  recharging) doesn't count.

## 0.3.1

First public release.

- Plugin icon in the README.
