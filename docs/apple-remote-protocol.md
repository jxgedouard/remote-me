# Apple TV remote: reverse-engineered protocol

> Notes from reverse-engineering the remote built into iOS (Control Center) and checking every claim against a real Apple TV 4K (3rd gen). Addresses are from the iOS 27.0.1 shared cache and only make sense for that build.

Source: iOS 27.0.1 (24A446) `dyld_shared_cache_arm64e` from Apple's official IPSW
(`iPhone17,1_27.0.1_24A446_Restore.ipsw`). Frameworks extracted with `ipsw dyld extract --objc --slide --stubs`
and analysed with **REA 6.4.0 + Ghidra 12.1.4** (`rea analyze / search / decompile / read-bytes`).

| Binary | Version | Role |
|---|---|---|
| `TVRemoteCore.framework` | 627.0.28 | Remote logic used by the Control Center module (`TVRemoteModule.bundle`) and `TVRemoteUI` |
| `Rapport.framework` | 751.100.2 | Companion Link transport (wire names, framing, HID/touch sessions) |
| `MediaRemote.framework` | 4026.110.4 | Now-playing model (not used by the native remote for control anymore) |

## Why the first backend failed

`node-appletv-x` speaks legacy MRP over a dedicated TCP port. The native remote on current tvOS does **not**:
`TVRCRapportDeviceImpl` (the only `_TVRCDeviceImpl` besides MatchPoint/HomeKit) routes everything through
`RPCompanionLinkClient` → Companion protocol, service `_companion-link._tcp`.

## Transport (Rapport)

* Discovery: mDNS `_companion-link._tcp`, TXT keys `rpMac`, `rpBA`, `rpFl`, `rpMd` (model), `rpVr` (Rapport version).
* Frame: `type:u8 | length:u24 BE | payload`. Types seen in Rapport: `PS_Start`(3) `PS_Next`(4) `PV_Start`(5) `PV_Next`(6)
  `U_OPACK`(7) `E_OPACK`(8).
* Payloads are OPACK-encoded dictionaries. After pair-verify, `E_OPACK` payloads are ChaCha20-Poly1305 encrypted
  (AAD = 4-byte header, nonce = 96-bit little-endian counter, keys = HKDF-SHA512(shared, "", `ClientEncrypt-main` / `ServerEncrypt-main`)).
* Messages: `{_i: name, _t: 1 event | 2 request | 3 response, _x: xid, _c: content}`.
* Pairing: HAP SRP-6a (3072-bit, SHA-512, user `Pair-Setup`) wrapped as `{_pd: TLV8, _pwTy: 1}`;
  verify = X25519 + Ed25519 wrapped as `{_pd: TLV8, _auTy: 4}`.

## TVRemoteCore session layer (iOS 27): required

After Rapport's `_systemInfo` + `_sessionStart`, the native remote opens its own session
(`-[TVRCRPCompanionLinkClientWrapper _sendSessionStartWithCompletion:]` @ `0x2aecc7be0`):
request `TVRCSessionStart {ProtocolVersionKey: "1.2"}`. Without it the Apple TV acknowledges legacy
`_hidC` but silently ignores every TVRemoteCore request (apps, attention state...). Verified live on
AppleTV14,1 / Rapport 715.2.

| Purpose | Request / event | Content (verified live) |
|---|---|---|
| Buttons | request `HIDCommand` | `{HIDCommand: cmd, HIDButtonState: 1 down / 2 up}` |
| Touch start | request `HIDTouchStart` | `{TouchFlags: 0, Height, Width}` → `{Identifier}` |
| Touch | event `HIDTouch` (@ `0x2aeca6864`) | `{Nanoseconds, TouchFinger, TouchPhase (Began 1, Moved 2, Ended 3, Cancelled 4, Stationary 5), CoordinateX, CoordinateY}` |
| Apps | request `FetchLaunchableApplicationsEvent` (@ `0x2aecc5e8c`) | `{IncludeAppMetadataKey, AppRangeStartingIndexKey: "0", AppRangeCountKey: "N", UsePNG}` → `{AppCountKey, AppInfos: {bundleId: name}}` |
| Power | request `FetchAttentionState` | → `{state}`: 1 Asleep, 2/3 awake variants |
| Touch stop | request `HIDTouchStop` | `{}` |
| Media | request `MediaControlCommand` | `{MediaControlCommand: n}` → e.g. `{MessageKeyVolume: 0.5}`; status via `FetchMediaControlStatus` → `{MediaControlFlags}` |

## HID buttons: `-[TVRCHIDSession hidCommand:buttonState:completion:]` @ `0x2aeca5ae4`

Rapport `-[RPHIDSession hidCommand:buttonState:destinationID:completion:]` @ `0x1bf8ae748` sends request
`_hidC` with `{_hidC: command, _hBtS: state}`.

`_stateForButtonEvent:` @ `0x2aeca5d80`: eventType Pressed(1) → 1 (down), Released(2) → 2 (up).

`_commandForButtonEvent:` @ `0x2aeca5d20` indexes table `0x2aecec7e0` (`u32[30]`) with `buttonType - 1`:

| TVRCButtonType | HID `_hidC` | | TVRCButtonType | HID `_hidC` |
|---|---|---|---|---|
| 1 Select | 6 | | 12 ArrowUp | 1 |
| 2 Menu | 5 | | 13 ArrowDown | 2 |
| 3 Home | 7 | | 14 ArrowLeft | 3 |
| 4 Siri | 10 | | 15 ArrowRight | 4 |
| 5 PlayPause | 14 | | 19 ScreenSaver | 11 |
| 10 VolumeUp | 8 | | 21 Wake | 13 |
| 11 VolumeDown | 9 | | 22 Sleep | 12 |
| 26 ChannelUp | 15 | | 27 ChannelDown | 16 |
| 28 Guide | 17 | | 29 PageUp | 18 |
| 30 PageDown | 19 | | | |

### Arrows are dropped while a touch session is open

Found by live testing, not in the binary: with an `HIDTouchStart` session open, the Apple TV acknowledges
`HIDCommand` 1-4 (arrows) but ignores them; Select, Menu, Home and Play/Pause still work. The iOS remote
only opens the touch session while the touchpad layout is on screen, which hides the problem there.
remote-me closes the session (`HIDTouchStop`) before an arrow press and reopens it on the next touch
(`backend/companion/client.js`, `_touchSession`).

How it was confirmed: one Companion session at a time (a second session with the same credentials gets
dropped), then three variants sent a few seconds apart while a person watched the TV. Only
"`HIDTouchStop` then `HIDCommand 4`" moved the focus. Tip: focus changes on the home screen emit
`TopShelfItems` events, a useful signal when nobody is watching (nothing fires on the screensaver).

## Touchpad: `RPHIDTouchSession` @ `0x1bf8aeac8`, `0x1bf8af280`

`_touchStart` request `{_width, _height, _tFl}` → response `_i` (touch device ID). Events `_hidT`
`{_ns: nanoseconds, _tFg: finger, _tPh: phase, _cx, _cy}`; `_touchStop` closes.

## Other requests (strings in TVRemoteCore `__cstring` / Rapport)

* Apps: `FetchLaunchableApplicationsEvent`, `_launchApp {_bundleID | _urlS}`.
* Media control: `_mcc {_mcc: cmd, _vol, _skpS}`: Play 1, Pause 2, NextTrack 3, PrevTrack 4, GetVolume 5,
  SetVolume 6, SkipBy 7, FF begin/end 8/9, Rewind begin/end 10/11, captions 12/13. Flags event `_iMC {_mcF}`.
* Session: `_systemInfo`, `_sessionStart`, `_tiStart/_tiC/_tiStop` (keyboard), `_interest`.
* TVRemoteCore-level events: `FetchCurrentNowPlayingInfoEvent` / `NowPlayingInfo`, `FetchAttentionState`,
  `TVSystemStatus`, `ToggleCaptions`, `FetchUserAccountsEvent`, `SwitchUserAccountEvent`, `FetchUpNextInfoEvent`, `PlayMediaEvent`.

## Remote keyboard (RTI)

Rapport's legacy text-input calls still work under the TVRemoteCore session:

* `_tiStart` request: subscribes and returns `_tiD` if a text field is focused right now.
* Events `_tiStarted {_tiD}` / `_tiStopped` when a field gains or loses focus.
* `_tiD` is an `NSKeyedArchiver` binary plist: `sessionUUID` (NSUUID bytes), `documentState.docSt`
  (`contextBeforeInput`, `selectedText`, `contextAfterInput`) and `documentTraits` (the field title, e.g. the
  Spotify search prompt).
* Text goes back as event `_tiC {_tiV: 1, _tiD}` where `_tiD` archives an `RTITextOperations` targeting the
  session: `textToAssert: ""` clears the field, `keyboardOutput.insertionText` inserts text, `"
"` acts as Return.
  The object layout matches what pyatv sends; see `backend/companion/keyboard.js`.

Verified live on the Spotify tvOS app search field.

