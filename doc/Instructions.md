Yes, combining **Guest Mode** with your glovebox PIN and a forked **teslausb** setup makes for a very strong, multi-layered defense against a Turo guest tampering with or deleting footage — especially since Guest Mode adds meaningful restrictions.

### What Guest Mode Actually Does (Relevant to Your Setup)
From Tesla's Fleet API docs and owner reports (as of early 2026), when you enable **Guest Mode** (via the Tesla app or API before handing over the car), it restricts several UI features for the active driver profile:
- Can't enable/disable **PIN to Drive**.
- Can't change **Speed Limit Mode** settings.
- Can't access or change **Glovebox PIN**.
- Can't add/remove keys.
- Can't rename the vehicle.
- It also enables the "erase_user_data" command (which wipes personal UI data like navigation history, but **does not touch the USB drive or TeslaCam footage**).

Importantly for you:
- **Formatting the USB drive** (Controls > Safety > Format USB Drive) is blocked or unavailable in Guest Mode on many models/configs. Owners report errors like "remove Guest Mode to format" when trying to reformat for Sentry/Dashcam setup — this matches cases where the car refuses formatting until Guest Mode is disabled.
- Deleting all Dashcam/Sentry clips (via Controls > Safety > Delete Dashcam Footage) may also be restricted or grayed out in some implementations, though it's less consistently documented (some owners say it's still accessible, but formatting — the nuclear option that wipes everything — is reliably blocked).
- Guests can still manually delete individual clips via the Dashcam Viewer (if they find and select them), but they **can't do a full wipe/format** without your intervention (disabling Guest Mode remotely via app/API, which you control as host).

This is a big win for Turo hosts — it prevents the "easy erase everything" path that malicious guests might take.

### How Forking teslausb Fits Perfectly
With the emulated USB (via Pi) staying plugged in and the car in Guest Mode:
- Tesla keeps writing new clips normally (RecentClips overwrite hourly; Saved/Sentry persist until space runs low).
- Guest can't format the emulated drive → your teslausb fork's local copy process stays uninterrupted.
- Your modification (e.g., inotify-based watcher) detects each new .mp4 file as it's created/renamed and immediately copies it to a separate folder on the Pi's SD card (or better, an attached external USB drive for more space).
  - This happens **locally/offline** — no WiFi/internet needed, so guest disabling WiFi does nothing.
  - Even if they manage to delete clips from the TeslaCam folder via viewer (slow and tedious for many files), your Pi has already copied them elsewhere.
  - If they somehow force a re-plug or cause issues, the Pi's copy survives as long as the hardware isn't physically removed.

### Refined Implementation Tips for Your Fork
Build on the inotify approach I sketched earlier — it's lightweight and reactive:

- Install `inotify-tools` on the Pi (it's in Raspberry Pi OS repos).
- Run a dedicated watcher script as a systemd service (add to teslausb's startup sequence).
- Example enhanced snippet (add to a new file like `local_copy_watcher.sh`):
  ```bash
  #!/bin/bash
  set -euo pipefail

  # Load teslausb config if needed
  source /etc/teslausb.conf || true

  TESLACAM_PATH="/teslaCamMount/TeslaCam"  # Adjust if your mount differs
  BACKUP_ROOT="/home/pi/tesla_backup"       # Or /mnt/external_usb/tesla_backup for attached drive
  LOG_FILE="/var/log/tesla_local_copy.log"

  mkdir -p "$BACKUP_ROOT/RecentClips" "$BACKUP_ROOT/SavedClips" "$BACKUP_ROOT/SentryClips"

  echo "$(date): Watcher started" >> "$LOG_FILE"

  inotifywait -m -e create -e moved_to -e close_write --format '%w%f' \
    "$TESLACAM_PATH/RecentClips" \
    "$TESLACAM_PATH/SavedClips" \
    "$TESLACAM_PATH/SentryClips" | while read -r NEWFILE; do
      if [[ -f "$NEWFILE" && "${NEWFILE##*.}" == "mp4" ]]; then
        RELPATH="${NEWFILE#$TESLACAM_PATH/}"
        DEST_DIR="$BACKUP_ROOT/$(dirname "$RELPATH")"
        mkdir -p "$DEST_DIR"
        cp -p "$NEWFILE" "$DEST_DIR/" || echo "Copy failed: $NEWFILE" >> "$LOG_FILE"
        echo "$(date): Copied $RELPATH" >> "$LOG_FILE"
      fi
  done
  ```
  - Make it executable, add a systemd unit to start it after teslausb mounts the emulated drive.
  - For robustness: Add checks for file size (>0) to avoid copying incomplete writes; rsync instead of cp for better handling of renames.

- **Storage management**: Use a large microSD (128GB+) or attach a small SSD/USB drive to the Pi (via hub). Add a cron job to prune old backups (e.g., keep 7–30 days) if space is tight.
- **Testing**: Simulate by plugging into a non-Tesla USB host or use teslausb's test mode; verify copies happen seconds after Tesla creates a clip.

### Overall Setup Strength for Turo
- Glovebox PIN → blocks physical unplug/replug of Pi/USB.
- Guest Mode → blocks format/full wipe.
- teslausb fork with immediate local copy → redundant copy survives even partial deletions.
- Hidden Pi enclosure (e.g., 3D-printed or taped securely) → deters discovery.

This should give you excellent coverage without any internet dependency. Few guests will go beyond casual deletion attempts, and this blocks the big ones.

If you share your Pi model, whether you're attaching extra storage, or any specific config hurdles, I can refine the script/systemd details further!