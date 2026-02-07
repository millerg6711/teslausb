#!/bin/bash
#
# clear_recent.sh - Clear the RecentClips folder
#
# This deletes the rolling 1-hour recording buffer to free up space.
# Note: Tesla will immediately start refilling this folder when driving.
#

# Output HTTP headers
cat << 'EOF'
HTTP/1.0 200 OK
Content-type: application/json

EOF

# Check if already running
if [ -f /tmp/clearing_recent ]; then
  echo '{"status": "busy", "message": "Already clearing"}'
  exit 0
fi

touch /tmp/clearing_recent

# Run in background
sudo -b bash -c '
  exec >> /tmp/clear_recent.log 2>&1
  echo "$(date): Starting RecentClips cleanup"
  
  # Mount the cam image if not already mounted
  MOUNTED_HERE=false
  if ! mountpoint -q /mnt/cam 2>/dev/null; then
    echo "$(date): Mounting cam image"
    if [ -f /backingfiles/cam_disk.bin ]; then
      LOOP_DEV=$(losetup -f)
      losetup -P "$LOOP_DEV" /backingfiles/cam_disk.bin
      mkdir -p /mnt/cam
      mount "${LOOP_DEV}p1" /mnt/cam
      MOUNTED_HERE=true
    fi
  fi
  
  RECENT_DIR="/mnt/cam/TeslaCam/RecentClips"
  
  if [ -d "$RECENT_DIR" ]; then
    # Count files before
    BEFORE=$(find "$RECENT_DIR" -name "*.mp4" 2>/dev/null | wc -l)
    SIZE_BEFORE=$(du -sh "$RECENT_DIR" 2>/dev/null | cut -f1)
    
    echo "$(date): Found $BEFORE files ($SIZE_BEFORE)"
    
    # Delete all mp4 files
    find "$RECENT_DIR" -name "*.mp4" -delete 2>/dev/null
    
    # Also delete thumbnails
    find "$RECENT_DIR" -name "*.png" -delete 2>/dev/null
    
    echo "$(date): Deleted $BEFORE files"
  else
    echo "$(date): RecentClips directory not found"
  fi
  
  # Sync to ensure writes are flushed
  sync
  
  # Unmount if we mounted it
  if [ "$MOUNTED_HERE" = "true" ]; then
    echo "$(date): Unmounting cam image"
    umount /mnt/cam 2>/dev/null || true
    losetup -d "$LOOP_DEV" 2>/dev/null || true
  fi
  
  echo "$(date): Cleanup complete"
  rm -f /tmp/clearing_recent
'

echo '{"status": "started", "message": "Clearing RecentClips (Tesla will refill when driving)"}'
