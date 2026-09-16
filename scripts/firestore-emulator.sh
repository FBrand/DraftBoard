#!/bin/sh
# The Firestore emulator, containerised.
#
# firebase-tools 15 requires Java 21 and this host has 17, so the JDK comes
# from the image rather than from the box. Nothing is installed on the host.
set -e
apk add -q openjdk21-jre-headless

# Start from empty debug logs, every time.
#
# These grow without bound and they are not harmless: at 2.4GB in one session
# the emulator degraded until a rules test that had always passed began
# failing. It happened again at 920MB — 23 rules tests went to 22, with nothing
# wrong in the code, and the fix both times was to truncate and restart.
#
# They are written as root from inside this container, so the host cannot clear
# them without a container of its own. Doing it here is the one place that
# always has permission.
: > firebase-debug.log 2>/dev/null || true
: > firestore-debug.log 2>/dev/null || true
: > ui-debug.log 2>/dev/null || true
exec ./node_modules/.bin/firebase emulators:start \
  --only firestore,auth --project demo-draftboard
