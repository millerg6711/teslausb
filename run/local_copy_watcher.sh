#!/bin/bash -eu

# Local Copy Watcher
# Monitors TeslaCam folders for new files and immediately copies them to a local backup location.
# This provides protection against tampering/deletion by creating redundant copies
# that persist even if the original files are deleted from the TeslaCam folder.

if [ "${BASH_SOURCE[0]}" != "$0" ]
then
  echo "${BASH_SOURCE[0]} must be executed, not sourced"
  return 1
fi

# Check if local copy is enabled
if [ "${LOCAL_COPY_ENABLED:-false}" != "true" ]
then
  log "Local Copy Watcher: Not enabled."
  exit 0
fi

# Verify inotifywait is available
if ! command -v inotifywait &> /dev/null
then
  log "Local Copy Watcher: inotifywait not found. Please install inotify-tools."
  exit 1
fi

# Configuration
TESLACAM_PATH="${LOCAL_COPY_SOURCE:-/mnt/cam/TeslaCam}"
BACKUP_ROOT="${LOCAL_COPY_DEST:-/mutable/local_backup}"
LOG_PREFIX="Local Copy Watcher:"

# Ensure backup directories exist
mkdir -p "$BACKUP_ROOT/RecentClips" "$BACKUP_ROOT/SavedClips" "$BACKUP_ROOT/SentryClips"

log "$LOG_PREFIX Started. Watching $TESLACAM_PATH -> $BACKUP_ROOT"

# Function to safely copy a file
copy_file() {
  local src_file="$1"
  local rel_path="${src_file#$TESLACAM_PATH/}"
  local dest_dir="$BACKUP_ROOT/$(dirname "$rel_path")"
  local dest_file="$dest_dir/$(basename "$rel_path")"
  
  # Skip if not a regular file
  if [ ! -f "$src_file" ]
  then
    return 0
  fi
  
  # Skip files that are too small (likely incomplete)
  local file_size
  file_size=$(stat -c%s "$src_file" 2>/dev/null || echo "0")
  if [ "$file_size" -lt 100000 ]
  then
    log "$LOG_PREFIX Skipping small file (<100KB): $rel_path"
    return 0
  fi
  
  # Ensure destination directory exists
  mkdir -p "$dest_dir"
  
  # Copy with rsync for robustness (handles partial copies better than cp)
  if command -v rsync &> /dev/null
  then
    if rsync -a --no-perms "$src_file" "$dest_file" 2>/dev/null
    then
      log "$LOG_PREFIX Copied: $rel_path (${file_size} bytes)"
      return 0
    fi
  else
    if cp -p "$src_file" "$dest_file" 2>/dev/null
    then
      log "$LOG_PREFIX Copied: $rel_path (${file_size} bytes)"
      return 0
    fi
  fi
  
  log "$LOG_PREFIX Failed to copy: $rel_path"
  return 1
}

# Function to manage backup storage space
manage_backup_space() {
  local max_size="${LOCAL_COPY_MAX_SIZE:-32212254720}"  # Default 30GB
  local current_size
  current_size=$(du -sb "$BACKUP_ROOT" 2>/dev/null | cut -f1 || echo "0")
  
  if [ "$current_size" -gt "$max_size" ]
  then
    log "$LOG_PREFIX Storage limit exceeded (${current_size}/${max_size} bytes). Pruning old files..."
    
    # Delete oldest files first (by modification time)
    find "$BACKUP_ROOT" -type f -name "*.mp4" -printf '%T@ %p\n' 2>/dev/null | \
      sort -n | \
      while read -r timestamp filepath
      do
        current_size=$(du -sb "$BACKUP_ROOT" 2>/dev/null | cut -f1 || echo "0")
        if [ "$current_size" -le "$max_size" ]
        then
          break
        fi
        rm -f "$filepath"
        log "$LOG_PREFIX Pruned: ${filepath#$BACKUP_ROOT/}"
      done
    
    # Clean up empty directories
    find "$BACKUP_ROOT" -type d -empty -delete 2>/dev/null || true
    
    log "$LOG_PREFIX Pruning complete."
  fi
}

# Wait for TeslaCam directories to be available
wait_for_mount() {
  local max_wait=300
  local waited=0
  
  while [ ! -d "$TESLACAM_PATH" ]
  do
    if [ $waited -ge $max_wait ]
    then
      log "$LOG_PREFIX Timeout waiting for $TESLACAM_PATH to be available"
      return 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  
  return 0
}

# Build list of directories to watch (only those that exist)
build_watch_dirs() {
  local dirs=""
  for subdir in RecentClips SavedClips SentryClips
  do
    if [ -d "$TESLACAM_PATH/$subdir" ]
    then
      dirs="$dirs $TESLACAM_PATH/$subdir"
    fi
  done
  echo "$dirs"
}

# Main monitoring loop with restart capability
while true
do
  # Wait for the TeslaCam mount to be available
  if ! wait_for_mount
  then
    log "$LOG_PREFIX Mount not available, retrying in 60 seconds..."
    sleep 60
    continue
  fi
  
  # Build watch directories
  watch_dirs=$(build_watch_dirs)
  
  if [ -z "$watch_dirs" ]
  then
    log "$LOG_PREFIX No TeslaCam subdirectories found yet, retrying in 30 seconds..."
    sleep 30
    continue
  fi
  
  log "$LOG_PREFIX Monitoring: $watch_dirs"
  
  # Periodically check storage space (every ~100 files or so, handled by counter)
  file_counter=0
  
  # Start inotifywait and process events
  # Events: close_write (file finished writing), moved_to (file renamed into directory)
  # Using --recursive to catch files in subdirectories (for SavedClips/SentryClips date folders)
  # shellcheck disable=SC2086
  inotifywait -m -r -e close_write -e moved_to --format '%w%f' $watch_dirs 2>/dev/null | \
    while read -r new_file
    do
      # Only process mp4, json, and png files (TeslaCam file types)
      case "${new_file##*.}" in
        mp4|MP4|json|JSON|png|PNG)
          copy_file "$new_file"
          
          # Manage storage space periodically
          file_counter=$((file_counter + 1))
          if [ $((file_counter % 100)) -eq 0 ]
          then
            manage_backup_space
          fi
          ;;
      esac
    done
  
  # If inotifywait exits (e.g., watched directory unmounted), wait and restart
  log "$LOG_PREFIX inotifywait exited, restarting in 10 seconds..."
  sleep 10
done
