# Changelog

## 0.6.0 (unreleased)

- Multiple floors: every map saved on the robot is published, with its rooms. The Home app shows a
  Cleaning Map picker; rooms of the main map keep their ids, so existing scenes and automations keep
  working, and other maps' rooms use `map id * 1000 + room id`. Starting a clean on another floor
  switches the robot's map first and checks it, sets that floor's stair detection and checks that too,
  then does the security check and starts. A step the robot refuses or doesn't answer means no start,
  and the tile shows an error. The rooms you last picked are remembered even if the Home app was told
  they were refused, and a selection that isn't clean is refused rather than turned into a clean of
  everything.
- Stair detection per floor (on by default for every floor of a robot with several maps; a robot with
  one map is left alone unless you choose a value). A job running on a floor that needs it while the
  robot has it off is paused, with an error on the tile; Resume turns it back on.
- Cleaning plans are kept per map, and a plan is only used for rooms of its own map.
- Return to dock on a floor without a base station goes to the map's starting point; if the robot
  refuses or doesn't set off, the clean is ended and the tile shows an error. The robot shows as
  Stopped, not Docked, when it isn't on a base. Halts for the security system are timed to the
  starting point on such floors.
- Settings: floor and room names for the Home app, and stair detection per floor (`maps` in a
  robot's settings), listed on the settings page from the maps the robot reports.
- The robot's state file now keeps every map (`maps`, `plansByMap`); an older one is converted on
  start.

## Unreleased

- Rooms and cleaning plans now load by themselves. The robot only answers requests that look exactly like
  the Narwal app's, so before, they arrived only while the Narwal app was open; the plugin now asks the
  way the app does, at start and then every 6 hours. You no longer need to open the Narwal app on the map.
- Robots with more than one map (for example an upstairs map without a base station): the vacuum
  keeps the rooms of the map with the base station. Opening another map in the Narwal app no longer
  swaps the room list, and cleaning plans from another map are ignored.
- The log warns when the robot refuses a command (start, pause, resume, return to dock, stop, locate,
  consumable reset) or doesn't answer within 5 seconds.

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
