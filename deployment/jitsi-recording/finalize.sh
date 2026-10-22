#!/bin/bash
set -euo pipefail
# Jibri calls this only after ffmpeg has closed the recording. Host processing
# picks up the marker; speech recognition must never block this script.
recording_directory="$1"
test -d "$recording_directory"
touch -- "$recording_directory/.recording-complete.tmp"
mv -- "$recording_directory/.recording-complete.tmp" "$recording_directory/.recording-complete"
