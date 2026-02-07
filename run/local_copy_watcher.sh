#!/bin/bash

# Smart Archive Watcher
# Automatically archives TeslaCam clips based on network availability:
#   - WiFi available → sync to Mac and delete from Tesla
#   - WiFi unavailable → backup locally on Pi (fallback)
#
# Configuration (set in teslausb_setup_variables.conf):
#   LOCAL_BACKUP_ENABLED=true          # Enable/disable (default: false)
#   LOCAL_BACKUP_INTERVAL=120          # Check interval in seconds (default: 120)
#   LOCAL_BACKUP_MAX_SIZE=32212254720  # Max local backup size in bytes (default: 30GB)
#   LOCAL_BACKUP_SAVED=true            # Archive SavedClips (default: true)
#   LOCAL_BACKUP_SENTRY=true           # Archive SentryClips (default: true)
#   RSYNC_SERVER=<ip>                  # Mac IP address for network archive
#   RSYNC_USER=<user>                  # SSH user on Mac
#   RSYNC_PATH=<path>                  # Destination path on Mac

# Source config if available
if [ -f /root/teslausb_setup_variables.conf ]; then
  source /root/teslausb_setup_variables.conf
fi

log() {
  echo "$(date "+%Y-%m-%d %H:%M:%S") - ARCHIVE: $*"
}

# Configuration with defaults
ENABLED="${LOCAL_BACKUP_ENABLED:-false}"
BACKUP_DIR="${LOCAL_BACKUP_DIR:-/backingfiles/local_backup}"
CAM_DISK="${CAM_DISK:-/backingfiles/cam_disk.bin}"
CAM_MOUNT="${CAM_MOUNT:-/mnt/cam}"
SYNC_INTERVAL="${LOCAL_BACKUP_INTERVAL:-120}"
MAX_SIZE="${LOCAL_BACKUP_MAX_SIZE:-32212254720}"  # 30GB default
ARCHIVE_SAVED="${LOCAL_BACKUP_SAVED:-true}"
ARCHIVE_SENTRY="${LOCAL_BACKUP_SENTRY:-true}"

# Network archive settings
RSYNC_SERVER="${RSYNC_SERVER:-}"
RSYNC_USER="${RSYNC_USER:-}"
RSYNC_PATH="${RSYNC_PATH:-}"

# Check if enabled
if [ "$ENABLED" != "true" ]; then
  log "Disabled. Set LOCAL_BACKUP_ENABLED=true to enable."
  exit 0
fi

log "Starting Smart Archive Watcher..."
log "  Check interval: ${SYNC_INTERVAL}s"
log "  Archive SavedClips: $ARCHIVE_SAVED"
log "  Archive SentryClips: $ARCHIVE_SENTRY"
if [ -n "$RSYNC_SERVER" ]; then
  log "  Network archive: $RSYNC_USER@$RSYNC_SERVER:$RSYNC_PATH"
fi
log "  Local backup dir: $BACKUP_DIR (max $((MAX_SIZE / 1073741824))GB)"

# Create directories
mkdir -p "$BACKUP_DIR"
mkdir -p "$CAM_MOUNT"

# Function to check if network archive is reachable
network_reachable() {
  if [ -z "$RSYNC_SERVER" ]; then
    return 1  # No network archive configured
  fi
  
  # Quick ping check
  if ping -c 1 -W 3 "$RSYNC_SERVER" >/dev/null 2>&1; then
    return 0  # Reachable
  else
    return 1  # Not reachable
  fi
}

# Function to mount the Tesla disk
mount_cam() {
  # Check if disk image exists
  if [ ! -f "$CAM_DISK" ]; then
    log "ERROR: Disk image not found: $CAM_DISK"
    return 1
  fi
  
  # Already mounted?
  if mountpoint -q "$CAM_MOUNT" 2>/dev/null; then
    return 0
  fi
  
  # Setup loop device and mount
  local loop_dev
  loop_dev=$(losetup -f)
  losetup -P "$loop_dev" "$CAM_DISK"
  mount "${loop_dev}p1" "$CAM_MOUNT"
  
  if ! mountpoint -q "$CAM_MOUNT"; then
    log "ERROR: Could not mount disk"
    losetup -d "$loop_dev" 2>/dev/null || true
    return 1
  fi
  
  return 0
}

# Function to unmount the Tesla disk
unmount_cam() {
  if mountpoint -q "$CAM_MOUNT" 2>/dev/null; then
    sync
    umount "$CAM_MOUNT" 2>/dev/null || true
  fi
  # Clean up any loop devices for cam_disk
  losetup -j "$CAM_DISK" 2>/dev/null | cut -d: -f1 | while read -r loop; do
    losetup -d "$loop" 2>/dev/null || true
  done
}

# Function to do network archive (sync to Mac, delete from Tesla)
network_archive() {
  log "Network archive starting..."
  
  if ! mount_cam; then
    return 1
  fi
  
  local total_synced=0
  
  # Process SavedClips
  if [ "$ARCHIVE_SAVED" = "true" ]; then
    local saved_dir="$CAM_MOUNT/TeslaCam/SavedClips"
    if [ -d "$saved_dir" ]; then
      local file_count
      file_count=$(find "$saved_dir" -name "*.mp4" 2>/dev/null | wc -l)
      if [ "$file_count" -gt 0 ]; then
        log "Syncing $file_count SavedClips files to Mac..."
        if rsync -avh --timeout=120 --remove-source-files \
            --no-perms --omit-dir-times \
            "$saved_dir/" \
            "$RSYNC_USER@$RSYNC_SERVER:$RSYNC_PATH/TeslaCam/SavedClips/" 2>&1; then
          total_synced=$((total_synced + file_count))
          # Clean up empty directories
          find "$saved_dir" -type d -empty -delete 2>/dev/null || true
        else
          log "WARNING: rsync failed for SavedClips"
        fi
      fi
    fi
  fi
  
  # Process SentryClips
  if [ "$ARCHIVE_SENTRY" = "true" ]; then
    local sentry_dir="$CAM_MOUNT/TeslaCam/SentryClips"
    if [ -d "$sentry_dir" ]; then
      local file_count
      file_count=$(find "$sentry_dir" -name "*.mp4" 2>/dev/null | wc -l)
      if [ "$file_count" -gt 0 ]; then
        log "Syncing $file_count SentryClips files to Mac..."
        if rsync -avh --timeout=120 --remove-source-files \
            --no-perms --omit-dir-times \
            "$sentry_dir/" \
            "$RSYNC_USER@$RSYNC_SERVER:$RSYNC_PATH/TeslaCam/SentryClips/" 2>&1; then
          total_synced=$((total_synced + file_count))
          # Clean up empty directories
          find "$sentry_dir" -type d -empty -delete 2>/dev/null || true
        else
          log "WARNING: rsync failed for SentryClips"
        fi
      fi
    fi
  fi
  
  unmount_cam
  
  if [ "$total_synced" -gt 0 ]; then
    log "Network archive complete: $total_synced files synced to Mac"
  else
    log "Network archive: no new files to sync"
  fi
}

# Function to do local backup (fallback when no network)
local_backup() {
  log "Local backup starting..."
  
  if ! mount_cam; then
    return 1
  fi
  
  # Sync SavedClips
  if [ "$ARCHIVE_SAVED" = "true" ] && [ -d "$CAM_MOUNT/TeslaCam/SavedClips" ]; then
    rsync -av "$CAM_MOUNT/TeslaCam/SavedClips/" "$BACKUP_DIR/SavedClips/" 2>/dev/null
    local count
    count=$(find "$BACKUP_DIR/SavedClips" -type f 2>/dev/null | wc -l)
    log "SavedClips: $count files backed up locally"
  fi
  
  # Sync SentryClips
  if [ "$ARCHIVE_SENTRY" = "true" ] && [ -d "$CAM_MOUNT/TeslaCam/SentryClips" ]; then
    rsync -av "$CAM_MOUNT/TeslaCam/SentryClips/" "$BACKUP_DIR/SentryClips/" 2>/dev/null
    local count
    count=$(find "$BACKUP_DIR/SentryClips" -type f 2>/dev/null | wc -l)
    log "SentryClips: $count files backed up locally"
  fi
  
  unmount_cam
  
  log "Local backup complete"
}

# Function to manage local backup storage space
manage_backup_space() {
  local current_size
  current_size=$(du -sb "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
  
  if [ "$current_size" -gt "$MAX_SIZE" ]; then
    log "Local backup limit exceeded ($((current_size / 1073741824))GB / $((MAX_SIZE / 1073741824))GB). Pruning..."
    
    # Delete oldest files first
    find "$BACKUP_DIR" -type f -name "*.mp4" -printf '%T@ %p\n' 2>/dev/null | \
      sort -n | \
      while read -r timestamp filepath; do
        current_size=$(du -sb "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
        if [ "$current_size" -le "$MAX_SIZE" ]; then
          break
        fi
        rm -f "$filepath"
        log "Pruned: ${filepath#$BACKUP_DIR/}"
      done
    
    find "$BACKUP_DIR" -type d -empty -delete 2>/dev/null || true
    log "Pruning complete"
  fi
}

# Main loop
while true; do
  if network_reachable; then
    log "WiFi available - archiving to Mac"
    network_archive
  else
    log "WiFi unavailable - backing up locally"
    local_backup
    manage_backup_space
  fi
  
  log "Next check in ${SYNC_INTERVAL}s..."
  sleep "$SYNC_INTERVAL"
done
