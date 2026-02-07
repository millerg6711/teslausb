# Local Copy Watcher Setup Guide (Tamper Protection for Turo Hosts)

This guide walks you through setting up a Raspberry Pi with teslausb and the Local Copy Watcher feature, which provides protection against footage tampering or deletion by periodically backing up dashcam files to a separate location.

## Overview

The Local Copy Watcher:
- Periodically syncs SavedClips and SentryClips to a backup location (every 2 minutes)
- Uses `rsync` to efficiently copy only new files
- Works completely offline — no WiFi or internet required
- Automatically manages storage by pruning oldest files when limit is reached

**Note:** Real-time monitoring with `inotifywait` doesn't work when Tesla has exclusive block-level access to the disk image via USB gadget mode. The periodic sync approach remounts the disk to see fresh data.

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
- **Micro-USB DATA cable** (NOT a charge-only cable — this is critical!)
- **Power source** for initial setup (computer USB port works)

**IMPORTANT: USB Cable Selection**

Many USB cables are "charge-only" and will NOT work. The Pi will power on but Tesla won't see the drive. You need a cable that carries both power AND data. Test by:
1. Plugging Pi into your Mac/PC
2. Running `diskutil list external` (Mac) or checking Disk Management (Windows)
3. If you see a ~70GB drive appear, the cable works

If nothing appears, try a different cable. Data cables are often thicker and labeled "data" or "sync".

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
ls -la /backingfiles/local_backup/
ls -la /backingfiles/local_backup/SavedClips/
ls -la /backingfiles/local_backup/SentryClips/
```

You should see copied files after the first sync cycle (within 2 minutes).

### Step 6.3: Check the Service Status

```bash
sudo systemctl status local_copy_watcher
```

You should see "active (running)".

### Step 6.4: Check the Logs

```bash
sudo journalctl -u local_copy_watcher -n 20
```

You should see entries like:
```
2026-02-07 00:50:39 - Starting sync...
2026-02-07 00:51:57 - SavedClips backup: 30 files
2026-02-07 00:51:57 - SentryClips backup: 0 files
2026-02-07 00:51:57 - Sync complete
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

### Tesla shows "Insert USB Drive"

**Most common cause: Charge-only USB cable**

1. Test the cable by plugging Pi into your Mac/PC
2. Run `diskutil list external` (Mac) or check Disk Management (Windows)
3. If no drive appears, the cable is charge-only — use a different cable

Other checks:
- Ensure you're using the **USB port** on the Pi (closer to HDMI), not the **PWR port**
- SSH into Pi and check: `cat /sys/class/udc/*/state` — should show "configured"
- Check if g_mass_storage is loaded: `lsmod | grep g_mass`

### Pi not booting / LED not flashing

- Ensure you used a USB **data** cable, not charge-only
- Try re-flashing the SD card
- Check that the SD card is fully inserted

### WiFi not connecting

- Double-check SSID and password in config (watch for special characters)
- Ensure your WiFi is 2.4GHz (Pi Zero 2 W supports both, but check your network)
- SSH via USB: connect Pi to computer, then `ssh pi@teslausb.local`

### Local Copy Watcher not running

Check service status:
```bash
sudo systemctl status local_copy_watcher
```

Check logs for errors:
```bash
sudo journalctl -u local_copy_watcher -n 30
```

Verify the script exists:
```bash
ls -la /root/bin/local_copy_watcher.sh
```

### No backup files appearing

Backups only appear after the sync cycle (every 2 minutes). Check:
```bash
ls -la /backingfiles/local_backup/
```

If still empty after a few minutes, check the service logs for errors.

### Storage full

Check disk space:
```bash
df -h /backingfiles
```

The watcher auto-prunes old files, but you can manually clear:
```bash
sudo rm -rf /backingfiles/local_backup/SavedClips/*
```

---

## Technical Details

- **Sync method**: Periodic `rsync` every 2 minutes (configurable via `SYNC_INTERVAL`)
- **Folders backed up**: SavedClips and SentryClips (not RecentClips to save space)
- **Copy method**: `rsync -av --ignore-existing` (only copies new files)
- **Mount strategy**: Read-only remount each sync cycle to see fresh data from Tesla
- **USB gadget**: Uses `g_mass_storage` kernel module to present disk to Tesla
- **Default backup location**: `/backingfiles/local_backup`
- **Default max size**: 30GB (configurable via `LOCAL_BACKUP_MAX_SIZE`)

### Why Periodic Sync Instead of Real-Time?

When the Pi presents the disk image to Tesla via USB gadget mode, Tesla writes directly to the block device. The Pi's local filesystem mount doesn't see these changes in real-time because:

1. Tesla has exclusive block-level access via `g_mass_storage`
2. The local mount's cache doesn't reflect changes made at the block level
3. `inotifywait` only detects changes made through the local filesystem

The periodic sync approach solves this by unmounting and remounting the disk image each cycle, which forces the filesystem to read fresh data from the block device.
