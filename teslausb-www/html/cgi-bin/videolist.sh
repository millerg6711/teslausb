#!/bin/bash

cat << EOF
HTTP/1.0 200 OK
Content-type: text/plain

EOF

# Find symlinks (original behavior)
find /mutable/TeslaCam -type l -printf "%P\n" 2>/dev/null

# Also find regular mp4 files, following symlinks (-L flag)
# This enables the viewer to show backup files accessed via symlinked directories
find -L /mutable/TeslaCam -type f -name "*.mp4" -printf "%P\n" 2>/dev/null
