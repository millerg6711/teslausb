#!/bin/bash

# Local Copy Watcher (Periodic Sync)
# Periodically syncs TeslaCam SavedClips and SentryClips to a local backup location.
# This provides protection against tampering/deletion by creating redundant copies
# that persist even if the original files are deleted from the TeslaCam folder.
#
# Note: Real-time inotifywait monitoring doesn't work when Tesla has exclusive
# block-level access to the disk image via USB gadget mode. This periodic sync
# approach remounts the disk to see fresh data and syncs new files.

log() {
  echo "$(date "+%Y-%m-%d %H:%M:%S") - $*"
}

# Configuration
LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-/backingfiles/local_backup}"
CAM_DISK="${CAM_DISK:-/backingfiles/cam_disk.bin}"
CAM_MOUNT="${CAM_MOUNT:-/mnt/cam}"
SYNC_INTERVAL="${SYNC_INTERVAL:-120}"  # seconds between syncs (default 2 minutes)

log "Periodic Backup Sync starting..."
log "Backup directory: $LOCAL_BACKUP_DIR"
log "Camera disk: $CAM_DISK"
log "Sync interval: ${SYNC_INTERVAL}s"

# Create directories
mkdir -p "$LOCAL_BACKUP_DIR"
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
  
  # Sync SavedClips (important clips user explicitly saved)
  if [ -d "$CAM_MOUNT/TeslaCam/SavedClips" ]; then
    rsync -av --ignore-existing "$CAM_MOUNT/TeslaCam/SavedClips/" "$LOCAL_BACKUP_DIR/SavedClips/" 2>/dev/null
    SAVED_COUNT=$(find "$LOCAL_BACKUP_DIR/SavedClips" -type f 2>/dev/null | wc -l)
    log "SavedClips backup: $SAVED_COUNT files"
  fi
  
  # Sync SentryClips (automatically captured security events)
  if [ -d "$CAM_MOUNT/TeslaCam/SentryClips" ]; then
    rsync -av --ignore-existing "$CAM_MOUNT/TeslaCam/SentryClips/" "$LOCAL_BACKUP_DIR/SentryClips/" 2>/dev/null
    SENTRY_COUNT=$(find "$LOCAL_BACKUP_DIR/SentryClips" -type f 2>/dev/null | wc -l)
    log "SentryClips backup: $SENTRY_COUNT files"
  fi
  
  # Note: RecentClips are not backed up by default to save space
  # They are continuously overwritten by Tesla anyway
  
  # Cleanup
  umount "$CAM_MOUNT" 2>/dev/null || true
  losetup -d "$LOOP" 2>/dev/null || true
  
  log "Sync complete"
}

# Function to manage backup storage space
manage_backup_space() {
  local max_size="${LOCAL_BACKUP_MAX_SIZE:-32212254720}"  # Default 30GB
  local current_size
  current_size=$(du -sb "$LOCAL_BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
  
  if [ "$current_size" -gt "$max_size" ]; then
    log "Storage limit exceeded (${current_size}/${max_size} bytes). Pruning old files..."
    
    # Delete oldest files first (by modification time)
    find "$LOCAL_BACKUP_DIR" -type f -name "*.mp4" -printf '%T@ %p\n' 2>/dev/null | \
      sort -n | \
      while read -r timestamp filepath; do
        current_size=$(du -sb "$LOCAL_BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
        if [ "$current_size" -le "$max_size" ]; then
          break
        fi
        rm -f "$filepath"
        log "Pruned: ${filepath#$LOCAL_BACKUP_DIR/}"
      done
    
    # Clean up empty directories
    find "$LOCAL_BACKUP_DIR" -type d -empty -delete 2>/dev/null || true
    
    log "Pruning complete."
  fi
}

# Main loop
while true; do
  sync_files
  
  # Periodically check storage space
  manage_backup_space
  
  log "Sleeping ${SYNC_INTERVAL}s until next sync..."
  sleep "$SYNC_INTERVAL"
done
