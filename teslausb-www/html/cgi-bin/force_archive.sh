#!/bin/bash
#
# force_archive.sh - Sync Tesla clips directly to Mac and delete from Tesla
#
# This syncs SavedClips/SentryClips from the Tesla disk directly to the
# network archive (Mac), then deletes the synced files from Tesla.
#

# Output HTTP headers
cat << 'EOF'
HTTP/1.0 200 OK
Content-type: application/json

EOF

# Source the config
eval "$(sudo cat /root/teslausb_setup_variables.conf 2>/dev/null | grep -E '^export ')"

# Check if archive system is configured
if [ -z "$RSYNC_SERVER" ] || [ -z "$RSYNC_USER" ]; then
  echo '{"status": "error", "message": "Network archive not configured"}'
  exit 0
fi

# Check if already running
if [ -f /tmp/archiving_in_progress ]; then
  echo '{"status": "busy", "message": "Archive already in progress"}'
  exit 0
fi

touch /tmp/archiving_in_progress

# Run in background
sudo -b bash -c '
  exec >> /tmp/force_archive.log 2>&1
  echo "$(date): Starting network archive"
  
  source /root/teslausb_setup_variables.conf
  
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
      echo "$(date): Mounted on $LOOP_DEV"
    fi
  fi
  
  TOTAL_SYNCED=0
  
  # Process SavedClips and SentryClips
  for cliptype in SavedClips SentryClips; do
    LOCAL_DIR="/mnt/cam/TeslaCam/$cliptype"
    
    if [ ! -d "$LOCAL_DIR" ]; then
      echo "$(date): No $cliptype directory"
      continue
    fi
    
    # Count files
    FILE_COUNT=$(find "$LOCAL_DIR" -name "*.mp4" 2>/dev/null | wc -l)
    if [ "$FILE_COUNT" -eq 0 ]; then
      echo "$(date): No files in $cliptype"
      continue
    fi
    
    echo "$(date): Syncing $cliptype ($FILE_COUNT files) to Mac..."
    
    # Rsync directly to Mac with --remove-source-files
    cd /mnt/cam
    if rsync -avh --timeout=120 --remove-source-files \
        --no-perms --omit-dir-times \
        "TeslaCam/$cliptype/" \
        "$RSYNC_USER@$RSYNC_SERVER:$RSYNC_PATH/$cliptype/" 2>&1; then
      
      TOTAL_SYNCED=$((TOTAL_SYNCED + FILE_COUNT))
      echo "$(date): Synced $FILE_COUNT files from $cliptype"
      
      # Clean up empty directories
      find "$LOCAL_DIR" -type d -empty -delete 2>/dev/null || true
    else
      echo "$(date): Rsync failed for $cliptype"
    fi
  done
  
  echo "$(date): Total synced and deleted: $TOTAL_SYNCED files"
  
  # Sync filesystem
  sync
  
  # Unmount if we mounted it
  if [ "$MOUNTED_HERE" = "true" ]; then
    echo "$(date): Unmounting cam image"
    umount /mnt/cam 2>/dev/null || true
    losetup -d "$LOOP_DEV" 2>/dev/null || true
  fi
  
  echo "$(date): Archive complete"
  rm -f /tmp/archiving_in_progress
'

echo '{"status": "started", "message": "Syncing to Mac..."}'
