# Security hold

Motion sensors can mistake a robot vacuum for an intruder: ecobee's do, and set off the alarm.
With the security hold on, the robot asks the security system to switch from **Away** to **Home**
(ecobee's Stay) before it starts, so it can clean safely. Doors and windows stay armed. When the
robot is done, the system goes back to Away.

## Setting it up

1. Install a security system plugin that supports holds, and allow holds in its settings.
   [homebridge-ecobee-security](https://github.com/seanfletchr/homebridge-ecobee-security) is one:
   turn on **Allow security holds** and tick **Narwal Freo** in its list of plugins.
2. In this plugin's settings, turn on **Keep security from arming Away while cleaning** and pick the
   security system. The list shows every installed plugin that supports holds.

A security system that isn't a Homebridge plugin can take part too, through anything that answers
the [API](#api) (a home automation hub or a webhook, for example): choose **Other** and enter its
address.

In `config.json`: `"securityHold": true`, plus `"securityPlugin": "<package name>"` or
`"securityEndpoint": "<socket path or http(s) URL>"`. With neither, the only installed plugin that
supports holds is used.

## What happens

With homebridge-ecobee-security (another security plugin may handle some of these differently):

| Situation | What happens |
|---|---|
| The robot starts cleaning while the system is armed **Away** (from the Home app, Siri, an automation or the Narwal app) | The system switches to Home. When the cleaning job ends, it's armed Away again with the normal countdown. Trips back to the base to wash the mops don't end the job. |
| The robot starts while the system is in **Home**, **Night** or **Off** | Nothing changes. |
| The robot gets stuck, is picked up or is paused mid-job | Once it hasn't moved for 10 minutes, the system goes back to Away. As soon as it moves again, the system switches back to Home within a couple of seconds. |
| You arm **Away in the Home app** while the robot is cleaning | The system stays in Home until the robot is done, then arms Away. |
| You turn on **Arm Away Now**, or arm **Away in the ecobee app** | The robot heads back to its base. The countdown waits up to 2 more minutes for it and arms as soon as it's docked. If the robot won't make it in time, it pauses where it is before the sensors arm. |
| You arm **Away at the keypad** | The robot pauses where it is. (The keypad's countdown isn't visible to the plugin, so there's no time to send it home.) |
| You change the security system yourself while the robot is cleaning | Your choice wins: it's left as you set it when the robot is done. |
| The security system can't be reached, or an alarm is going off | The robot doesn't start, and the Home app shows an error. |

Two robots work the same way: Away comes back once both are done. A paused robot that you resume
switches the system to Home again.

### Settings

- **Back to Away when a robot stops moving for** (`securityStoppedMinutes`, default 10 minutes, 0 to
  wait until the job ends).
- The extra countdown time is the security plugin's setting (in homebridge-ecobee-security: **Extra
  time for tasks to finish**).

### Good to know

- **Only Away is affected.** If your security system's Home mode also watches motion sensors
  on the robot's route, the hold doesn't cover that.
- **It fails safe:** when in doubt, the robot doesn't start, rather than risk a false alarm.

## API

For developers of security system plugins (the **server**), and of plugins that want to ask for a
hold (the **client**). Clients don't have to be robots: anything whose task could trip a motion
sensor can use it, such as an AC that blows plants around.

### Overview

1. **Hold:** before its task starts, the client asks the server to keep Away off. The server
   switches Away to Home if needed, and says whether it's safe to start.
2. **Release:** when the task is done, the client says so, and the server re-arms Away if it
   switched it to Home.
3. **Stop (optional):** if Away is armed anyway while the task is running, the server asks the
   client to stop, or to finish by a given time. The client can answer that it's finishing and say
   when it's done, so the server can wait for it.

A client counts as **active** from its first accepted hold until it releases, whether or not the
server had to switch anything.

### Where the server listens

- **A Homebridge plugin:** serve HTTP on a Unix socket in the Homebridge storage folder (mode 600,
  homebridge user only) and declare its path, relative to the storage folder, in `package.json`:

  ```json
  "homebridge-security-hold": { "socket": "my-security/control.sock" }
  ```

  Clients find servers that way; this plugin's settings page lists them by `displayName`.
- **Anything else:** serve the same requests at an http(s) URL. Clients append the paths to it;
  basic auth in the URL works.

Clients can declare `"homebridge-security-hold": { "client": true }` in their `package.json`, so a
server can list them (for example, to let users allow each one) before their first request.

### Requests to the server

Every request carries `by`, the name of what's being held for (for this plugin, the robot's name), and
optionally `plugin`, the client's package name, so servers can allow holds per plugin. Track holds
per `by`: with two robots out, the first one done must not re-arm Away.

| Request | What the server does | Answer |
|---|---|---|
| `POST /hold?by=…&plugin=…&halt=…` | If the system is armed Away or arming Away, switch it to Home. Remember `by` as active (and its `halt` endpoint, if given). | 2xx, optionally `{ "ok": true, "held": true\|false, "state": "…" }`. Not safe to start (alarm going off, state unknown, not allowed): `{ "ok": false, "reason": "…" }` or any non-2xx status. |
| `POST /release?by=…&plugin=…` | Forget `by`. If it was the last active client and the system is still in the Home the hold set, arm Away. If anyone changed the system meanwhile, leave it alone. Always accept a release from an active client, even if its permission was taken away. | 2xx, optionally `{ "released": true\|false, "state": "…", "waiting": [names still active] }`. |

A plain webhook that answers 2xx with no body works: it's taken as held / released.

**Away while clients are active.** If you can intercept the request (homebridge-ecobee-security can
for the Home app), you can wait for the last release and arm Away then. If you can't (the ecobee app,
a keypad), send each active client's `halt` endpoint a stop request (below) and stop treating it as
active. Optionally, if a client answers that it's finishing, extend the exit delay, and end it once
that client releases.

### Stop requests to the client

`POST <halt>/halt?by=…&armAt=<ISO time>` (no `by`: everything the client is doing). `armAt` is when the
motion sensors arm (the end of the exit delay); without it, stop now.

The client stops its task by `armAt`, either by finishing (a robot docking) or by stopping where it is,
and answers 2xx with `{ "halted": true|false, "returning": true|false, "reason": "…" }`.
`"returning": true` means "finishing, I'll release when I'm done": the server may then extend the exit
delay (and should send the later `armAt`) and end it at the release.

### Client rules

- Ask for a hold before the task starts, and don't start on a "no" or an error.
- Release after every accepted hold, whether or not anything was held, so the server knows when
  you're done.
- Don't retry a hold in the background; ask again the next time the task starts.
- After a stop, ask for a new hold if the task starts again (not while finishing).

### This plugin as a client

It serves stop requests on a Unix socket at `<homebridge storage>/narwal/control.sock` (mode 600).
Given `armAt`, it sends the robot back to its base and pauses it where it is if it isn't docked
10 seconds before. It skips the trip only when it can't possibly make it (16 seconds to set off and
dock, plus the straight line to the base at 0.25 m/s). Routes around furniture are often longer;
the deadline covers that. It releases once the robot is docked, or paused, and logs how long the
trip took.
