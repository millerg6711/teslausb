#!/bin/bash -eu

# Local backup directory (for cleanup after successful archive)
LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-/backingfiles/local_backup}"
CLEANUP_LOCAL_BACKUP="${LOCAL_BACKUP_DELETE_AFTER_ARCHIVE:-true}"

while [ -n "${1+x}" ]
do
  SOURCE_DIR="$1"
  FILES_LIST="$2"
  
  if ! (rsync -avhRL --timeout=60 --remove-source-files --no-perms --omit-dir-times \
        --stats --log-file=/tmp/archive-rsync-cmd.log --ignore-missing-args \
        --files-from="$FILES_LIST" "$SOURCE_DIR" "$RSYNC_USER@$RSYNC_SERVER:$RSYNC_PATH" &> /tmp/rsynclog || [[ "$?" = "24" ]] )
  then
    cat /tmp/archive-rsync-cmd.log /tmp/rsynclog > /tmp/archive-error.log
    exit 1
  fi
  
  # Clean up local backup after successful network archive
  if [ "$CLEANUP_LOCAL_BACKUP" = "true" ] && [ -d "$LOCAL_BACKUP_DIR" ]; then
    while IFS= read -r file; do
      # Extract relative path (e.g., TeslaCam/SavedClips/2024-01-01_12-00-00/file.mp4)
      # and delete from local backup
      BACKUP_FILE="$LOCAL_BACKUP_DIR/${file#TeslaCam/}"
      if [ -f "$BACKUP_FILE" ]; then
        rm -f "$BACKUP_FILE"
        echo "Cleaned up local backup: $BACKUP_FILE"
      fi
    done < "$FILES_LIST"
    
    # Remove empty directories
    find "$LOCAL_BACKUP_DIR" -type d -empty -delete 2>/dev/null || true
  fi
  
  shift 2
done
