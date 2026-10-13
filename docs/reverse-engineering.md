# How the Apple TV side was reverse-engineered

This is my first reverse-engineering project applied to home automation, done together with an AI coding
agent (Claude Code) driving the tools. This page describes the method, so it can be repeated on the next iOS
or tvOS release.

## The problem

The first version used an npm library speaking MRP, the protocol older Apple remotes used. Pairing worked, but
current tvOS ignored most commands. Rather than guess, the plan was to read how Apple's own remote (the one in
iOS Control Center) talks to the Apple TV today.

## Toolchain

| Step | Tool | Output |
|---|---|---|
| Get the system binaries | Apple's official iOS IPSW (iOS 27.0.1, iPhone 17) and [`ipsw`](https://github.com/blacktop/ipsw) | `dyld_shared_cache_arm64e` |
| Extract frameworks | `ipsw dyld extract --objc --slide --stubs` | `TVRemoteCore`, `Rapport`, `MediaRemote` as standalone Mach-O files |
| Analyse | [REA](https://github.com/morluto/rea) 6.4 with Ghidra 12.1 | Strings, functions, decompiled pseudo-code, raw bytes, as evidence files |
| Verify | A small Node.js Companion client and a real Apple TV | Every request in [the protocol notes](apple-remote-protocol.md) marked "verified" was sent to the device |

On Windows, REA's Ghidra provider only accepts PE executables, so the analysis ran with a locally patched copy
that lets Mach-O targets through. The macOS / Linux setups do not need this.

## Method

1. **Find the right layer.** Class names in `TVRemoteCore` (`TVRCRapportDeviceImpl`,
   `TVRCRPCompanionLinkClientWrapper`) showed that the remote goes through Rapport's Companion link
   (`_companion-link._tcp`), not MRP. That alone explained the first failure.
2. **Read the wire names.** `__cstring` searches gave the request names (`HIDCommand`, `HIDTouch`,
   `FetchLaunchableApplicationsEvent`...) and the dictionary keys next to them.
3. **Decompile the senders.** Each `-[TVRCHIDSession ...]` / `-[TVRCRPCompanionLinkClientWrapper ...]` method
   shows which keys it puts in the dictionary and in which order, and lookup tables such as the
   button type to HID code table (`u32[30]` at `0x2aecec7e0`).
4. **Find the missing handshake.** Requests were acknowledged but did nothing until the session start
   `TVRCSessionStart {ProtocolVersionKey: "1.2"}` was found in `_sendSessionStartWithCompletion:`.
5. **Test on the device, with a person watching.** Some behaviour is not in the client binary at all: the
   Apple TV drops arrow commands while a touch session is open. That was found by sending labelled variants a
   few seconds apart and asking what moved on screen.

## What the AI did, and what it did not

- It ran the extraction and REA commands, read the evidence, wrote the Companion client and the interface,
  and proposed the live tests.
- Every protocol claim was checked on real hardware before being kept. When something could not be verified
  (for example the LG firmware, see [lg-webos.md](lg-webos.md)), it is written down as not verified or not possible.
- The final calls (scope, design, what to keep) were mine.

## Repeating it on a new iOS release

1. Download the new IPSW, extract `TVRemoteCore` and `Rapport` again.
2. Diff the `__cstring` lists of request names against the table in `apple-remote-protocol.md`.
3. Decompile only the methods whose names or keys changed.
4. Re-run the live checks: pairing, buttons, arrows after a touch, touch, apps, keyboard.
