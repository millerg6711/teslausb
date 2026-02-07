# teslausb

## Intro

Raspberry Pi and other [SBCs](## "Single Board Computers") can emulate a USB drive, so can act as a drive for your Tesla to write dashcam footage to. Because the SBC has full access to the emulated drive, it can:

- automatically copy the recordings to an archive server when you get home
- hold both dashcam recordings and music files
- automatically repair filesystem corruption produced by the Tesla's current failure to properly dismount the USB drives before cutting power to the USB ports
- serve up a web UI to view or download the recordings
- retain more than one hour of RecentClips (assuming large enough storage)

This video (not mine) has a nice overview of teslausb and how to install it:

[![teslausb intro and installation](http://img.youtube.com/vi/ETs6r1vKTO8/0.jpg)](http://www.youtube.com/watch?v=ETs6r1vKTO8 "teslausb intro and installation")

If you are interested in having more detailed information about how TeslaUsb works, have a look into the [wiki](https://github.com/marcone/teslausb/wiki).

## Prerequisites

### Assumptions

- You park in range of your wireless network.
- Your wireless network is configured with WPA2 PSK access.

### Hardware

Required:

- [A Raspberry Pi or other SBC that supports USB OTG](https://github.com/marcone/teslausb/wiki/Hardware).
- A Micro SD card, at least 64 GB in size, and an adapter (if necessary) to connect the card to your computer.
- Cable(s) to connect the SBC to the Tesla (USB A/Micro B cable for the Pi Zero, USB A/C cable for the Pi 4 and 5, other SBCs vary)

Optional:

- A case and/or cooler for the SBC. For the Raspberry Pi 4 I like the ["armor case"](https://www.amazon.com/s?k=Raspberry+Pi+4+Armor+Case) (available with or without fans), which appears to do a good job of protecting the Pi while keeping it cool.
- USB Splitter if you don't want to lose a front USB port. [The Onvian Splitter](https://www.amazon.com/gp/product/B01KX4TKH6) has been reported working by multiple people on reddit. Some SBCs require separate power and data connection, so may require a splitter or a USB hub to connect to the car.

## Fork Features

This fork (`millerg6711/teslausb`) includes additional features for Turo hosts and fleet operators:

### Local Copy Watcher (Tamper Protection)

Periodically backs up dashcam footage to a separate location on the SD card, protecting against:
- Guest attempts to delete footage
- USB format operations (footage survives in backup)
- Tampering during rentals

See [Local Copy Watcher Setup Guide](doc/LocalCopyWatcher.md) for full instructions.

### SEI Telemetry Display

View Tesla's embedded vehicle telemetry overlaid on dashcam footage:
- Speed, gear, and autopilot state
- Steering angle and brake indicator
- GPS coordinates and G-forces

Requires Tesla firmware 2025.44.25+ and Hardware 3+.

### Network Archive with Security Hardening

Archive footage to your home Mac/PC with restricted SSH access:
- Dedicated user isolation
- Write-only access (stolen Pi can't read your files)
- Automatic cleanup after successful archive

See [Part 7 of the Local Copy Watcher guide](doc/LocalCopyWatcher.md#part-7-network-archive-setup-optional).

## Installing

To install teslausb on a Raspberry Pi, it is recommended to use the [prebuilt image](https://github.com/marcone/teslausb/releases) and [one step setup instructions](doc/OneStepSetup.md). For other SBCs, start [here](https://github.com/marcone/teslausb/wiki/Installation)

**To use this fork's features**, add to your `teslausb_setup_variables.conf`:

```bash
export REPO=millerg6711
export BRANCH=main-dev
```

## Contributing

You're welcome to contribute to this repo by submitting pull requests and creating issues.
For pull requests, please split complex changes into multiple pull requests when feasible, and follow the existing code style.

## Meta

This repo contains steps and scripts originally from [this thread on Reddit](https://www.reddit.com/r/teslamotors/comments/9m9gyk/build_a_smart_usb_drive_for_your_tesla_dash_cam/)

Many people in that thread suggested that the scripts be hosted on GitHub but the author didn't seem interested in making that happen, so GitHub user "cimryan" hosted the scripts on GitHub with the Reddit user's permission.
