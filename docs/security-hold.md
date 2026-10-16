# Security hold

A robot vacuum cleaning while you're away sets off the motion sensors of a security system armed
**Away**. The security hold avoids that: the security system is switched to **Stay** while a robot
cleans, and back to Away when it's done.

## What happens

1. **A robot starts cleaning** (from the Home app, Siri, an automation or the Narwal app). If the
   security system is armed Away (or arming Away), it's switched to Stay. If it's in any other state,
   nothing changes.
2. **The cleaning job ends.** Trips back to the dock mid-job to wash the mops don't count. Once every
   robot that asked for the hold is done, the security system is armed Away again, with its normal
   exit delay.
3. **Your changes win.** If anyone changes the security system during the hold (say, you disarm on
   arriving home), it's left as it is when the robot is done.
4. **It fails safe.** If the security system can't be reached, can't say what state it's in, or the
   alarm is going off, the robot doesn't start (the Home app shows an error) rather than risking a
   false alarm.

## Setting it up

1. Install a security system plugin that offers the hold, and allow holds in its settings if it asks
   for that. [homebridge-ecobee-security](https://github.com/seanfletchr/homebridge-ecobee-security)
   is one: turn on **Allow security holds** and tick **Narwal Freo** in its list of plugins.
2. In this plugin's settings, turn on **Switch from Away to Stay while cleaning** and pick the
   security system. The list shows every installed plugin that offers the hold.

A security system that isn't a Homebridge plugin can take part too, if something in front of it
answers the API below (for example a home automation hub or a webhook): choose **Other** and enter
its address.

In `config.json`: `"securityHold": true` with either `"securityPlugin": "<package name>"` or
`"securityEndpoint": "<socket path or http(s) URL>"`. With neither, the only installed plugin that
offers the hold is used.

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

- `POST <endpoint>/hold?by=<name>&plugin=<package>`
  - If the system is armed Away (or arming Away): switch it to Stay and remember the hold.
  - If it's already held: add `by` to the holders.
  - Otherwise: change nothing.

  Answer 2xx, optionally with JSON `{ "ok": true, "held": true|false, "state": "…" }`. When it isn't
  safe to start (alarm going off, state unknown), answer `{ "ok": false, "reason": "…" }` or any
  non-2xx status (e.g. 403 when holds aren't allowed for this plugin): the client doesn't start.

- `POST <endpoint>/release?by=<name>&plugin=<package>`
  - Accept it from a current holder even if its permission was taken away meanwhile, so the
    system isn't left in Stay.
  - Remove `by` from the holders.
  - If it was the last one and the system is still in the Stay the hold set: arm Away again.
  - If anyone changed the system during the hold: drop the hold and leave the system alone.

  Answer 2xx, optionally with JSON `{ "released": true|false, "state": "…", "waiting": [names] }`,
  `waiting` listing holders still out.

A plain webhook that answers 2xx without a body works too: it's taken as held / released.

### Clients

A client (like this plugin) asks for the hold before it starts moving and refuses to start on a
"no" or an error; releases when it's done; and doesn't
retry a hold in the background: it asks again the next time it starts.
