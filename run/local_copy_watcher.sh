#!/bin/bash

# Local Copy Watcher (Periodic Sync)
# Periodically syncs TeslaCam clips to a local backup location.
# This provides protection against tampering/deletion by creating redundant copies.
#
# Configuration (set in teslausb_setup_variables.conf):
#   LOCAL_BACKUP_ENABLED=true          # Enable/disable backup (default: false)
#   LOCAL_BACKUP_INTERVAL=120          # Sync interval in seconds (default: 120)
#   LOCAL_BACKUP_MAX_SIZE=32212254720  # Max backup size in bytes (default: 30GB)
#   LOCAL_BACKUP_SAVED=true            # Backup SavedClips (default: true)
#   LOCAL_BACKUP_SENTRY=true           # Backup SentryClips (default: true)
#   LOCAL_BACKUP_RECENT=false          # Backup RecentClips (default: false)

# Source config if available
if [ -f /root/teslausb_setup_variables.conf ]; then
  source /root/teslausb_setup_variables.conf
fi

log() {
  echo "$(date "+%Y-%m-%d %H:%M:%S") - LOCAL_BACKUP: $*"
}

# Configuration with defaults
ENABLED="${LOCAL_BACKUP_ENABLED:-false}"
BACKUP_DIR="${LOCAL_BACKUP_DIR:-/backingfiles/local_backup}"
CAM_DISK="${CAM_DISK:-/backingfiles/cam_disk.bin}"
CAM_MOUNT="${CAM_MOUNT:-/mnt/cam}"
SYNC_INTERVAL="${LOCAL_BACKUP_INTERVAL:-120}"
MAX_SIZE="${LOCAL_BACKUP_MAX_SIZE:-32212254720}"  # 30GB default
BACKUP_SAVED="${LOCAL_BACKUP_SAVED:-true}"
BACKUP_SENTRY="${LOCAL_BACKUP_SENTRY:-true}"
BACKUP_RECENT="${LOCAL_BACKUP_RECENT:-false}"

# Check if enabled
if [ "$ENABLED" != "true" ]; then
  log "Backup is disabled. Set LOCAL_BACKUP_ENABLED=true to enable."
  exit 0
fi

log "Starting..."
log "  Backup directory: $BACKUP_DIR"
log "  Sync interval: ${SYNC_INTERVAL}s"
log "  Max size: $((MAX_SIZE / 1073741824))GB"
log "  Backup SavedClips: $BACKUP_SAVED"
log "  Backup SentryClips: $BACKUP_SENTRY"
log "  Backup RecentClips: $BACKUP_RECENT"

# Create directories
mkdir -p "$BACKUP_DIR"
mkdir -p "$CAM_MOUNT"

# Function to sync files from TeslaCam to backup
sync_files() {
  log "Starting sync..."
  
  # Check if disk image exists
  if [ ! -f "$CAM_DISK" ]; then
    log "ERROR: Disk image not found: $CAM_DISK"
    return 1
  fi
  
  # Unmount if already mounted (to get fresh view)
  umount "$CAM_MOUNT" 2>/dev/null || true
  losetup -D 2>/dev/null || true
  
  # Setup loop device and mount
  losetup -fP "$CAM_DISK"
  LOOP=$(losetup -j "$CAM_DISK" | cut -d: -f1)
  
  if [ -z "$LOOP" ]; then
    log "ERROR: Could not setup loop device"
    return 1
  fi
  
  # Mount read-only to avoid conflicts with Tesla writing
  mount -o ro "${LOOP}p1" "$CAM_MOUNT"
  
  if ! mountpoint -q "$CAM_MOUNT"; then
    log "ERROR: Could not mount disk"
    losetup -d "$LOOP" 2>/dev/null || true
    return 1
  fi
  
  # Sync SavedClips
  # Using default rsync behavior (compares size + mtime) instead of --ignore-existing
  # This ensures incomplete files get re-copied once Tesla finishes writing them
  if [ "$BACKUP_SAVED" = "true" ] && [ -d "$CAM_MOUNT/TeslaCam/SavedClips" ]; then
    rsync -av "$CAM_MOUNT/TeslaCam/SavedClips/" "$BACKUP_DIR/SavedClips/" 2>/dev/null
    SAVED_COUNT=$(find "$BACKUP_DIR/SavedClips" -type f 2>/dev/null | wc -l)
    log "SavedClips: $SAVED_COUNT files"
  fi
  
  # Sync SentryClips
  if [ "$BACKUP_SENTRY" = "true" ] && [ -d "$CAM_MOUNT/TeslaCam/SentryClips" ]; then
    rsync -av "$CAM_MOUNT/TeslaCam/SentryClips/" "$BACKUP_DIR/SentryClips/" 2>/dev/null
    SENTRY_COUNT=$(find "$BACKUP_DIR/SentryClips" -type f 2>/dev/null | wc -l)
    log "SentryClips: $SENTRY_COUNT files"
  fi
  
  # Sync RecentClips (optional - disabled by default)
  if [ "$BACKUP_RECENT" = "true" ] && [ -d "$CAM_MOUNT/TeslaCam/RecentClips" ]; then
    rsync -av "$CAM_MOUNT/TeslaCam/RecentClips/" "$BACKUP_DIR/RecentClips/" 2>/dev/null
    RECENT_COUNT=$(find "$BACKUP_DIR/RecentClips" -type f 2>/dev/null | wc -l)
    log "RecentClips: $RECENT_COUNT files"
  fi
  
  # Cleanup
  umount "$CAM_MOUNT" 2>/dev/null || true
  losetup -d "$LOOP" 2>/dev/null || true
  
  log "Sync complete"
}

# Function to manage backup storage space
manage_backup_space() {
  local current_size
  current_size=$(du -sb "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
  
  if [ "$current_size" -gt "$MAX_SIZE" ]; then
    log "Storage limit exceeded ($((current_size / 1073741824))GB / $((MAX_SIZE / 1073741824))GB). Pruning..."
    
    # Delete oldest files first (by modification time)
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
    
    # Clean up empty directories
    find "$BACKUP_DIR" -type d -empty -delete 2>/dev/null || true
    
    log "Pruning complete"
  fi
}

# Main loop
while true; do
  sync_files
  manage_backup_space
  log "Next sync in ${SYNC_INTERVAL}s..."
  sleep "$SYNC_INTERVAL"
done
