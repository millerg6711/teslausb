# TeslaUSB Setup Guide (Network Archive for Turo Hosts)

This guide walks you through setting up a Raspberry Pi with teslausb for Tesla dashcam recording with automatic network archiving to your Mac.

## Overview

**The Setup:**
- Pi acts as a USB drive for Tesla dashcam
- When on WiFi: clips sync directly to your Mac
- When away from home: local backup on Pi (fallback)
- "Force Archive Now" button syncs and frees Tesla storage

**Key Features:**
- Direct Tesla → Mac sync over WiFi (no intermediate storage)
- Smart local backup only when WiFi unavailable
- Web UI buttons: "Force Archive Now" and "Clear RecentClips"
- Restricted SSH access for security (stolen Pi can't access other Mac files)

---

## What You'll Need

### Hardware

**Power Constraint:** The Tesla glovebox USB port provides limited power (~500mA-2A). Use a **Pi Zero 2 W** (not Pi 4).

**Required hardware:**
- **Raspberry Pi Zero 2 W** (~400-600mA power draw)
- **1TB microSD card** — Samsung EVO Plus, SanDisk Extreme, or similar
- **MicroSD card reader** for your computer
- **Micro-USB DATA cable** (NOT a charge-only cable!)
- **Power source** for initial setup

**IMPORTANT: USB Cable Selection**

Many USB cables are "charge-only" and will NOT work. Test by:
1. Plugging Pi into your Mac/PC
2. Running `diskutil list external` (Mac)
3. If you see a ~70GB drive appear, the cable works

---

## Part 1: Flash the teslausb Image

1. Download Pi Imager from https://www.raspberrypi.com/software/
2. Download teslausb image from https://github.com/marcone/teslausb/releases
3. Flash the image to SD card
4. Configure WiFi in `wpa_supplicant.conf.sample`
5. Configure settings in `teslausb_setup_variables.conf.sample`

---

## Part 2: Network Archive Setup (Mac)

### Create Dedicated User on Mac

For security, create a restricted user that can only access TeslaCam files:

```bash
# Create user
sudo dscl . -create /Users/teslausb
sudo dscl . -create /Users/teslausb UserShell /bin/bash
sudo dscl . -create /Users/teslausb RealName "TeslaUSB Archive"
sudo dscl . -create /Users/teslausb UniqueID 599
sudo dscl . -create /Users/teslausb PrimaryGroupID 20
sudo dscl . -create /Users/teslausb NFSHomeDirectory /Users/teslausb

# Create home directory
sudo mkdir -p /Users/teslausb/TeslaCam
sudo mkdir -p /Users/teslausb/.ssh
sudo mkdir -p /Users/teslausb/bin
sudo chown -R teslausb:staff /Users/teslausb

# Allow SSH access
sudo dseditgroup -o edit -a teslausb -t user com.apple.access_ssh
```

### Generate SSH Key on Pi

```bash
ssh pi@teslausb.local
sudo mount -o remount,rw /
sudo mkdir -p /root/.ssh
sudo ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N "" -C "teslausb-archive"
sudo cat /root/.ssh/id_ed25519.pub
sudo mount -o remount,ro /
```

Copy the public key output.

### Create Restricted Wrapper Script on Mac

```bash
cat > /Users/teslausb/bin/rrsync-teslacam << 'EOF'
#!/bin/bash
# Only allow rsync to TeslaCam directory
if [[ "$SSH_ORIGINAL_COMMAND" != rsync\ --server* ]]; then
    echo "Only rsync is allowed" >&2
    exit 1
fi
if [[ "$SSH_ORIGINAL_COMMAND" == *".."* ]]; then
    echo "Path traversal not allowed" >&2
    exit 1
fi
if [[ "$SSH_ORIGINAL_COMMAND" != *"TeslaCam"* ]]; then
    echo "Access restricted to TeslaCam directory" >&2
    exit 1
fi
exec $SSH_ORIGINAL_COMMAND
EOF
chmod +x /Users/teslausb/bin/rrsync-teslacam
```

### Add Pi's Key to Mac

```bash
echo 'command="/Users/teslausb/bin/rrsync-teslacam",restrict PI_PUBLIC_KEY_HERE' | \
  sudo tee /Users/teslausb/.ssh/authorized_keys
sudo chown teslausb:staff /Users/teslausb/.ssh/authorized_keys
sudo chmod 600 /Users/teslausb/.ssh/authorized_keys
```

### Configure Pi for Network Archive

Add to `/root/teslausb_setup_variables.conf` on Pi:

```bash
export ARCHIVE_SYSTEM=rsync
export RSYNC_USER=teslausb
export RSYNC_SERVER=YOUR_MAC_IP
export RSYNC_PATH=/Users/teslausb/TeslaCam
```

---

## Part 3: How It Works

### When Parked at Home (WiFi Available)

```
Tesla → Pi (USB) → Mac (direct rsync)
```

1. Tesla writes clips to USB drive (Pi)
2. Local backup watcher sees WiFi, **skips local backup**
3. Click "Force Archive Now" or wait for car disconnect
4. Pi syncs directly to Mac, deletes from Tesla

### When Away from Home (No WiFi)

```
Tesla → Pi (USB + local backup)
```

1. Tesla writes clips to USB drive
2. Local backup watcher does **local backup** to Pi storage
3. Files in two places: Tesla disk + Pi (tamper protection)

### When You Return Home

1. Click "Force Archive Now"
2. Syncs Tesla → Mac
3. Clears Tesla storage

---

## Part 4: Web Interface

Access at `http://teslausb.local`

### Tools Tab Buttons

| Button | Action |
|--------|--------|
| **Force Archive Now** | Sync SavedClips/SentryClips to Mac, delete from Tesla |
| **Clear RecentClips** | Delete 1-hour rolling buffer (~17GB) - Tesla refills when driving |

---

## Part 5: Security

### If Someone Steals the Pi

The SSH key on the Pi is restricted:
- ✅ Can rsync to `/Users/teslausb/TeslaCam/`
- ❌ Cannot get shell access
- ❌ Cannot access other directories
- ❌ Cannot read/modify other files on Mac

### Additional Security

- Disable password SSH login on Mac: `PasswordAuthentication no` in `/etc/ssh/sshd_config`
- Use Tesla Guest Mode + Glovebox PIN
- Files are backed up before guests can delete them

---

## Configuration Options

Add these to `/root/teslausb_setup_variables.conf`:

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_BACKUP_ENABLED` | `true` | Enable smart local backup (only when no WiFi) |
| `LOCAL_BACKUP_INTERVAL` | `120` | Check interval in seconds |
| `LOCAL_BACKUP_MAX_SIZE` | `32212254720` | Max local backup size (30GB) |
| `LOCAL_BACKUP_SAVED` | `true` | Backup SavedClips |
| `LOCAL_BACKUP_SENTRY` | `true` | Backup SentryClips |
| `ARCHIVE_SYSTEM` | `rsync` | Archive method |
| `RSYNC_USER` | - | SSH user on Mac |
| `RSYNC_SERVER` | - | Mac IP address |
| `RSYNC_PATH` | - | Path on Mac |

---

## Troubleshooting

### Tesla Shows "Insert USB Drive"
- Check USB cable is data-capable (not charge-only)
- Verify Pi is powered and booted
- Check `lsmod | grep g_mass` on Pi

### Archive Not Syncing
- Check WiFi: `ping YOUR_MAC_IP` from Pi
- Test SSH: `ssh teslausb@YOUR_MAC_IP` from Pi
- Check logs: `cat /tmp/force_archive.log` on Pi

### Storage Not Freeing
- Click "Force Archive Now" to sync and delete
- Check if files exist on Mac before deletion

---

## Storage Summary

| Location | Contents |
|----------|----------|
| **Tesla disk** (128GB) | RecentClips (17GB rolling) + SavedClips + SentryClips |
| **Pi backup** (only offline) | Fallback copy when no WiFi |
| **Mac archive** | Permanent storage of all clips |
