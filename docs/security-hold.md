# Security hold

A robot vacuum cleaning while you're away sets off the motion sensors of a security system armed
**Away**. The security hold keeps Away off while a robot cleans: if the system is armed Away when a
robot starts, it's switched to **Stay**, and it goes back to Away when the robot is done.

## What happens

1. **A robot starts cleaning** (from the Home app, Siri, an automation or the Narwal app). If the
   security system is armed Away (or arming Away), it's switched to Stay. If it's in any other state,
   nothing changes.
2. **The cleaning job ends.** Trips back to the dock mid-job to wash the mops don't count. Once every
   robot that asked for the hold is done, the security system is armed Away again, with its normal
   exit delay.
3. **A robot that stops lets go.** A robot that stands still away from its base mid-job (stuck,
   lifted, paused…) can't set off the motion sensors. Once it hasn't moved or turned for 10 minutes
   (**securityStoppedMinutes**), it releases its hold, so the system goes back to
   Away if no other robot is still holding it. As soon as it moves or turns again, it asks for a new
   hold, within a couple of seconds. Time in the base (mop washes, recharging) doesn't count, and
   neither does time when the robot's position isn't coming through. Set it to 0 to keep the hold
   until the job ends.
4. **Away while a robot is out.** The security plugin decides, but with homebridge-ecobee-security:
   - Away asked for in the **Home app** (a scene, automation, Siri or the tile) waits until the robot
     is done; the system stays in Stay meanwhile. Its **Arm Away Now** switch arms Away now and
     sends the robot back to its base.
   - Away the security plugin can't intercept (the ecobee app, a keypad) can't be refused, so the
     robot is sent back to its base.

   Sent back, the robot heads to its base unless it clearly can't be there 10 seconds before the
   exit delay ends. homebridge-ecobee-security extends the countdown to give it time (**Extra time
   for robots to get home**, 2 minutes by default) and arms as soon as it's in. If it isn't in by
   then, it pauses wherever it is, so it
   doesn't set off a motion sensor; if the end of the exit delay isn't known (Away armed at a
   keypad), it pauses right away. A paused robot asks for a new hold if it's resumed.
5. **Holds are about Away only.** Stay and Night are never held back: in a typical setup Home mode
   doesn't watch the motion sensors a robot passes, and holding Stay back would leave doors and
   windows unwatched. If Home mode watches motion sensors on the robot's route in your setup, holds
   don't cover that.
6. **Several requests.** They're handled one at a time. The latest request from the Home app wins:
   Stay, Night or Disarm there drop the hold and any waiting Away. A second robot joins the hold, and
   Away comes back only when the last one has released. Changes in the ecobee app or at a keypad are
   seen on the security plugin's next poll (within 10 seconds) and cancel the hold the same way. If
   anyone changes the security system during the hold (say, you disarm on arriving home), it's left
   as it is when the robot is done.
7. **It fails safe.** If the security system can't be reached, can't say what state it's in, or the
   alarm is going off, the robot doesn't start (the Home app shows an error) rather than risking a
   false alarm.

## Setting it up

1. Install a security system plugin that offers the hold, and allow holds in its settings if it asks
   for that. [homebridge-ecobee-security](https://github.com/seanfletchr/homebridge-ecobee-security)
   is one: turn on **Allow security holds** and tick **Narwal Freo** in its list of plugins.
2. In this plugin's settings, turn on **Keep security from arming Away while cleaning** and pick the
   security system. The list shows every installed plugin that offers the hold.

A security system that isn't a Homebridge plugin can take part too, if something in front of it
answers the API below (for example a home automation hub or a webhook): choose **Other** and enter
its address.

In `config.json`: `"securityHold": true` with either `"securityPlugin": "<package name>"` or
`"securityEndpoint": "<socket path or http(s) URL>"`. With neither, the only installed plugin that
offers the hold is used. `"securityStoppedMinutes"` (default 10, 0 = never) sets how long
a robot must stand still before it releases its hold.

## API

For authors of security system plugins (or anything else in front of a security system) that want
robot vacuums, and anything else that moves around the house, to be able to ask for a hold.

### Offering it from a Homebridge plugin

Serve the API over HTTP on a **Unix socket** in the Homebridge storage folder, readable only by the
homebridge user (mode 600), and declare it in your plugin's `package.json` with the path relative to
the storage folder:

```json
"homebridge-security-hold": { "socket": "my-security/control.sock" }
```

Plugins that support the hold find it there: this plugin's settings page lists every installed
plugin with that field, using its `displayName`.

Plugins that *ask* for holds can declare that too, so a security plugin can list them (with their
`displayName`) before their first request, for example to let you allow each one:

```json
"homebridge-security-hold": { "client": true }
```

### Offering it from anything else

Serve the same two requests at an http(s) URL. Clients append the paths to the URL they're given;
basic auth in the URL works.

### Requests

`by` is the name of whoever is asking (for this plugin, the robot's name in the Home app), and
`plugin` the asking plugin's package name, so holds can be allowed per plugin (`plugin` is optional;
without it, go by `by`). Track holds per `by`: with two robots out, the first one back must not
re-arm Away.

- `POST <endpoint>/hold?by=<name>&plugin=<package>&halt=<endpoint>`
  - If the system is armed Away (or arming Away): switch it to Stay and remember the hold.
  - If it's already held: add `by` to the holders.
  - Otherwise: change nothing.
  - Either way, remember that `by` is out, with its `halt` endpoint (optional: a Unix socket path or
    http(s) URL), until it releases. If the system is armed Away while it's out (from somewhere you
    can't hold off), send `POST <halt>/halt?by=<name>&armAt=<ISO time>` and forget it (drop it from
    the hold too). `armAt` is when the motion sensors arm (the end of the exit delay); leave it out
    if you don't know. If the client answers `"returning": true`, you can wait for it: extend the exit
    delay first (and send that later `armAt`), and end it once the client sends `/release`.
  - If Away is asked for while `by` is out and you can intercept it, you can instead wait for the
    release and arm Away then (homebridge-ecobee-security does this for the Home app; its Arm Away
    Now switch halts the robots and arms at once, with `armAt` at the end of the exit delay).

  Answer 2xx, optionally with JSON `{ "ok": true, "held": true|false, "state": "…" }`. When it isn't
  safe to start (alarm going off, state unknown), answer `{ "ok": false, "reason": "…" }` or any
  non-2xx status (e.g. 403 when holds aren't allowed for this plugin): the client doesn't start.

- `POST <endpoint>/release?by=<name>&plugin=<package>`
  - Accept it from a current holder even if its permission was taken away meanwhile, so the
    system isn't left in Stay. Clients release after every `ok` hold, held or not, so also accept
    it when nothing is held (answer `"released": false`).
  - Remove `by` from the holders.
  - If it was the last one and the system is still in the Stay the hold set: arm Away again.
  - If anyone changed the system during the hold: drop the hold and leave the system alone.

  Answer 2xx, optionally with JSON `{ "released": true|false, "state": "…", "waiting": [names] }`,
  `waiting` listing holders still out.

A plain webhook that answers 2xx without a body works too: it's taken as held / released.

### Clients

A client (like this plugin) asks for the hold before it starts moving and refuses to start on a
"no" or an error; releases after every hold the server accepted, held or not, so the server knows
when it's done; and doesn't retry a hold in the background: it asks again the next time it starts.

A client has to cope with being halted. It gives a `halt` endpoint with each hold and answers
`POST <halt>/halt?by=<name>&armAt=<ISO time>` (no `by`: all its robots) with 2xx and JSON
`{ "halted": true|false, "returning": true|false, "reason": "…" }`: by `armAt` (when given) the robot
must be back at its base (`returning`) or stopped where it is; without `armAt`, it stops now. A
client that answers `returning: true` sends `/release` once the robot is in, or has stopped: the
security plugin may extend the exit delay to wait for it (send the later `armAt`) and end it then. It asks
for a new hold when the robot moves again (not on the way back). This plugin serves it on a Unix
socket at `<homebridge storage>/narwal/control.sock` (mode 600): it sends the robot back if it can be
in its base 10 seconds before `armAt`, pauses it where it is if it isn't in by then, and logs how long
the trip took. It only skips the trip when it can't possibly make it (16 s to set off and dock plus
the straight line to the base at 0.25 m/s); routes around furniture are often longer, and the
deadline covers that.
