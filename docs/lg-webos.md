# LG webOS TV: what the network API allows

> Tested on an LG OLED B6 (2016) running webOS 3.0, firmware 05.70.55. Newer webOS versions expose more;
> everything marked "verified" was checked on the TV by a person watching the screen.

remote-me talks to the TV over **SSAP**, the WebSocket protocol LG's own phone apps use (ports 3000 / 3001),
through [`lgtv2`](https://github.com/hobbyquaker/lgtv2). The first connection shows an authorization prompt on
the TV; the client key it returns is stored in `backend/data/` (git-ignored).

## Works

| Feature | Call | Notes |
|---|---|---|
| Buttons (arrows, OK, Back, Home, Exit, Menu, Info, colors, media, volume) | pointer input socket, `button {name}` | Verified. The socket stays open between presses. |
| Open an app | `ssap://system.launcher/launch {id}` | Verified. `listApps` returns ~90 apps; the `visible` flag keeps the ~25 real ones. |
| Switch input | `ssap://tv/switchInput {inputId}` | `getExternalInputList` gives the user-defined labels and a `connected` flag per HDMI port. |
| Open a settings section | launch `com.palm.app.settings` with `params.target` | Verified for `picture`, `sound`, `channel`, `network`, `general`, `accessibility`. Any other target opens Picture. |
| Sound output | `ssap://com.webos.service.apiadapter/audio/changeSoundOutput {output}` | Accepted (internally calls `setSystemSettings`). |
| Volume | `ssap://audio/getVolume` (subscribable), `setVolume`, `setMute` | Only meaningful on TV speakers: with an optical speaker the TV reports `volume: -1`. |
| Text input | `ssap://com.webos.service.ime/insertText`, `deleteCharacters`, `sendEnterKey` | For an on-screen keyboard that is already open. |
| Toasts | `ssap://system.notifications/createToast {message}` | Verified; handy to label steps during live tests. |
| Power off / on | `ssap://system/turnOff`, Wake-on-LAN | Power on needs "Turn on via Wi-Fi" / "Mobile TV On" enabled in the TV network settings. |

## Does not work on this firmware

| What | Result | Consequence |
|---|---|---|
| Read settings values | `ssap://settings/getSystemSettings` answers `500 Application error` for every category and key tried | No generic "settings editor": the app opens the right settings page instead. |
| Run internal (luna) calls | `ssap://system.notifications/createAlert` (the usual workaround) answers `404`; it only exists from webOS 4 | Same as above. |
| App icons | Icon URLs from `listApps` (`https://<tv>:3001/resources/...`) answer `404` | Known apps use their App Store artwork, built-in apps a Phosphor glyph. |
| Current channel / channel list | `500` / `tuner channel map does not exist` | The TV mostly shows HDMI sources here. |

## Why not reverse-engineer the firmware too?

The goal was the same approach as the Apple TV side: read the firmware to find the allowed SSAP endpoints and
settings keys. It is blocked for now: LG firmware (`.epk`) is encrypted, the keys can only be dumped from a
rooted TV, and this exact firmware version is not available for download. If a rooted unit or the keys become
available, [`epk2extract`](https://github.com/Informatic/epk2extract) is the tool to start from.
