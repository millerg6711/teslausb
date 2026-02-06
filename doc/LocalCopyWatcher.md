# Local Copy Watcher Setup Guide (Tamper Protection for Turo Hosts)

This guide walks you through setting up a Raspberry Pi with teslausb and the Local Copy Watcher feature, which provides protection against footage tampering or deletion by immediately copying dashcam files to a separate backup location.

## Overview

The Local Copy Watcher:
- Monitors TeslaCam folders in real-time using `inotifywait`
- Immediately copies new .mp4, .json, and .png files to a backup location
- Works completely offline — no WiFi or internet required
- Automatically manages storage by pruning oldest files when limit is reached

Combined with Tesla's **Guest Mode** and a **Glovebox PIN**, this creates a multi-layer defense that protects your footage even if a guest attempts to delete it.

---

## What You'll Need

### Hardware

**Power Constraint:** The Tesla glovebox USB port provides limited power (~500mA-2A). This means you must use a **Pi Zero 2 W** (not Pi 4) and store everything on the **SD card** (no external SSD).

**Required hardware:**
- **Raspberry Pi Zero 2 W** (~400-600mA power draw)
- **1TB microSD card** — Samsung EVO Plus, SanDisk Extreme, or similar
  - Stores both Tesla USB drive + local backups
  - Single USB cable to glovebox, no power issues
- **MicroSD card reader** for your computer
- **Micro-USB data cable** (not a charge-only cable)
- **Power source** for initial setup (computer USB port works)

**Why 1TB SD card?**
- You're storing footage twice (Tesla USB + backup copy)
- 1TB gives you ~400GB for backups = 3-4 weeks retention
- No external drive means no power problems
- Simple, reliable, single-cable setup

### Storage Considerations

Since the Local Copy Watcher stores a **second copy** of all footage, you need a large SD card.

| SD Card Size | CAM_SIZE | Backup Space | Retention |
|--------------|----------|--------------|-----------|
| 512GB | 60G | 200GB | ~2 weeks |
| **1TB (recommended)** | **100G** | **400GB** | **~3-4 weeks** |

**Storage math:**
- Tesla writes ~7-10GB per hour of driving + Sentry events
- Sentry Mode can generate 20-50GB overnight in busy areas
- A week-long rental typically generates 50-150GB of footage
- You're storing it twice: once in Tesla USB, once in local backup

**Recommendation:** A **1TB microSD card** gives you 3-4 weeks of backup retention — plenty of time to retrieve footage after any Turo rental.

### Software

- [Raspberry Pi Imager](https://www.raspberrypi.com/software/) (free download for Windows/Mac/Linux)
- A text editor (Notepad on Windows, TextEdit on Mac, or any code editor)

### Network Information

- Your home WiFi network name (SSID)
- Your home WiFi password
- (Optional) Network share credentials if archiving to a NAS/server

---

## Part 1: Download and Flash the Image

### Step 1.1: Download the TeslaUSB Image

1. Go to the [TeslaUSB Releases page](https://github.com/marcone/teslausb/releases/latest)
2. Download the latest `.img.gz` or `.zip` image file

### Step 1.2: Flash the Image to the SD Card

1. Insert your MicroSD card into your computer
2. Open **Raspberry Pi Imager**
3. Click **"Choose OS"** → scroll down → select **"Use custom"**
4. Browse to and select the downloaded TeslaUSB image file
5. Click **"Choose Storage"** → select your MicroSD card
6. Click **"Write"** and wait for it to complete
7. When finished, remove and re-insert the SD card so it mounts again

> **Note:** The base image is the same for everyone. During setup, the Pi pulls the actual scripts from GitHub. You'll configure it to use your fork in Part 2.

---

## Part 2: Configure the SD Card

After flashing, the SD card will have a `boot` partition visible on your computer.

### Step 2.1: Create the Configuration File

1. Open the `boot` folder/drive on your SD card
2. Find the file `teslausb_setup_variables.conf.sample`
3. Make a copy and rename it to `teslausb_setup_variables.conf`
4. Open this file in a text editor

### Step 2.2: Point to Your Fork

**Important:** The Local Copy Watcher is not in the official teslausb release. You must point the setup to the fork that contains this feature.

Add these lines:

```bash
# Pull scripts from the fork with Local Copy Watcher
export REPO=millerg6711
export BRANCH=main-dev
```

### Step 2.3: Configure WiFi

Find and edit these lines (remove the `#` to uncomment):

```bash
export SSID='YourWiFiNetworkName'
export WIFIPASS='YourWiFiPassword'
```

**Important:** If your password contains special characters, wrap it in single quotes. If it contains a single quote, see the [quoting rules](https://github.com/marcone/teslausb/blob/main-dev/doc/OneStepSetup.md).

### Step 2.4: Configure Archive Method

Choose how you want to archive footage. For simplicity, you can start with `none` (local storage only):

```bash
export ARCHIVE_SYSTEM=none
```

Or configure CIFS (Windows/Mac file sharing) to archive to a NAS:

```bash
export ARCHIVE_SYSTEM=cifs
export ARCHIVE_SERVER=192.168.1.100
export SHARE_NAME=TeslaCam
export SHARE_USER=username
export SHARE_PASSWORD='password'
```

### Step 2.5: Configure Drive Sizes

Since you're storing two copies of footage, allocate storage carefully.

**For 1TB SD card (recommended):**

```bash
# Size of the emulated USB drive Tesla writes to
export CAM_SIZE=100G
```

**For smaller SD cards:**

| SD Card | CAM_SIZE |
|---------|----------|
| 256GB | 50G |
| 512GB | 80G |
| 1TB | 100G |

### Step 2.6: Enable Local Copy Watcher

Add these lines to enable tamper protection:

```bash
# Enable Local Copy Watcher for tamper protection
export LOCAL_COPY_ENABLED=true

# Set backup storage limit based on your SD card size
# 256GB SD: 107374182400 (100GB)
# 512GB SD: 214748364800 (200GB)
# 1TB SD:   429496729600 (400GB) - recommended
export LOCAL_COPY_MAX_SIZE=429496729600
```

#### Storage Size Reference

| SD Card | Backup Size | Bytes |
|---------|-------------|-------|
| 512GB | 200 GB | 214748364800 |
| **1TB** | **400 GB** | **429496729600** |

#### Storage Layout (1TB SD Card)

```
1TB MicroSD Card:
├── System/OS:             ~6 GB
├── Reserved space:        ~6 GB
├── CAM_SIZE (Tesla USB):  100 GB
├── LOCAL_COPY_MAX_SIZE:   400 GB (backups)
├── Snapshots/mutable:     ~200 GB
└── Buffer:                ~288 GB
```

This gives you **3-4 weeks of backup retention** — plenty of time for any Turo dispute.

### Step 2.7: Save the Configuration File

Save the file and safely eject the SD card from your computer.

---

## Part 3: Initial Pi Setup

### Step 3.1: Boot the Pi

1. Insert the configured MicroSD card into the Raspberry Pi
2. Connect the Pi to power (USB port on your computer works)
3. Wait for setup to complete (5-15 minutes depending on network speed)

The Pi's LED will flash in patterns to indicate progress:

| Flashes | Stage |
|---------|-------|
| 2 | Verifying configuration |
| 3 | Downloading setup scripts |
| 4 | Creating partitions and storage |
| 5 | Setup complete, rebooting |

After setup completes, the LED will pulse steadily (once per second).

### Step 3.2: Verify Setup (Optional)

You can SSH into the Pi to verify everything is working:

```bash
ssh pi@teslausb.local
```

Default password: `raspberry`

Check the setup log:

```bash
cat /teslausb/teslausb-headless-setup.log
```

Verify Local Copy Watcher is installed:

```bash
ls -la /root/bin/local_copy_watcher.sh
```

### Step 3.3: Change the Default Password (Recommended)

For security, change the default password:

```bash
sudo -i
/root/bin/remountfs_rw
passwd pi
```

Enter a new password when prompted, then reboot:

```bash
reboot
```

---

## Part 4: Install in Your Tesla

### Step 4.1: Physical Installation

1. **Locate the USB port** in your Tesla's center console (glovebox or armrest)
2. **Connect the Pi** using a USB data cable to the data port
3. **Position the Pi** securely — consider a small enclosure or velcro mounting

### Step 4.2: Verify Tesla Recognizes the Drive

1. In your Tesla, go to **Controls** → **Safety** → **Dashcam**
2. You should see the dashcam icon appear indicating storage is available
3. If prompted to format, select **Yes** (this formats the emulated USB drive, not the Pi's SD card)

### Step 4.3: Enable Sentry Mode (Optional)

Go to **Controls** → **Safety** → **Sentry Mode** and enable it if desired.

---

## Part 5: Configure Tesla for Tamper Protection

### Step 5.1: Set Up Glovebox PIN

This prevents guests from physically accessing the Pi:

1. Go to **Controls** → **Safety** → **Glovebox PIN**
2. Set a 4-digit PIN
3. The glovebox will now require the PIN to open

### Step 5.2: Enable Guest Mode Before Each Rental

Before handing over the car to a Turo guest:

1. Open the **Tesla app** on your phone
2. Go to **Security** → **Guest Mode**
3. Enable **Guest Mode**

Guest Mode restrictions (relevant to your setup):
- Cannot format USB drive (blocked or shows error)
- Cannot change Glovebox PIN
- Cannot add/remove keys
- Can still manually delete individual clips (but your watcher has already copied them)

### Step 5.3: Disable Guest Mode After Rental

After the rental ends, disable Guest Mode via the Tesla app to regain full control.

---

## Part 6: Verify Everything is Working

### Step 6.1: Generate Test Footage

1. With the Pi installed and car awake, honk the horn or trigger Sentry Mode
2. Wait a minute for clips to be written

### Step 6.2: Check Backup Files

SSH into the Pi:

```bash
ssh pi@teslausb.local
```

Check the backup directory:

```bash
ls -la /mutable/local_backup/
ls -la /mutable/local_backup/SentryClips/
```

You should see copied files.

### Step 6.3: Check the Log

```bash
grep "Local Copy" /mutable/archiveloop.log
```

You should see entries like:
```
Local Copy Watcher: Copied SentryClips/2026-02-04_12-30-00/front.mp4 (8234567 bytes)
```

---

---

## Security Summary

| Layer | Protection | Setup Location |
|-------|------------|----------------|
| **Glovebox PIN** | Blocks physical access to Pi | Tesla → Controls → Safety |
| **Guest Mode** | Blocks format/wipe operations | Tesla App → Security |
| **Local Copy Watcher** | Redundant copies survive deletions | teslausb_setup_variables.conf |
| **Changed Pi Password** | Prevents SSH access if discovered | `passwd pi` command |

---

## Troubleshooting

### Pi not booting / LED not flashing

- Ensure you used a USB **data** cable, not charge-only
- Try re-flashing the SD card
- Check that the SD card is fully inserted

### WiFi not connecting

- Double-check SSID and password in config (watch for special characters)
- Ensure your WiFi is 2.4GHz (Pi Zero W doesn't support 5GHz)
- SSH via USB: connect Pi to computer, then `ssh pi@teslausb.local`

### Local Copy Watcher not running

Check if it's enabled:
```bash
grep LOCAL_COPY /boot/teslausb_setup_variables.conf
```

Check the log:
```bash
grep -i "local copy" /mutable/archiveloop.log
```

Verify the script exists:
```bash
ls -la /root/bin/local_copy_watcher.sh
```

### No backup files appearing

Check that TeslaCam directories exist:
```bash
ls -la /mnt/cam/TeslaCam/
```

The watcher only copies files after Tesla writes them. Generate some footage first.

### Storage full

Check disk space:
```bash
df -h
```

The watcher auto-prunes old files, but you can manually clear:
```bash
rm -rf /mutable/local_backup/RecentClips/*
```

---

## Technical Details

- **Monitoring method**: `inotifywait` with `close_write` and `moved_to` events
- **File types copied**: .mp4, .json, .png
- **Minimum file size**: 100KB (smaller files skipped as incomplete)
- **Copy method**: `rsync` if available, falls back to `cp`
- **Restart behavior**: Auto-restarts if watched directories become unavailable
- **Default backup location**: `/mutable/local_backup`
- **Default max size**: 10GB (configurable)
