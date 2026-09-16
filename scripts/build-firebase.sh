#!/bin/sh
# Builds the app against the Firestore emulator.
#
# All four of API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID must be present or
# `connect()` refuses outright — and the refusal arrives as a console.warn per
# collection, after which every read returns {} and the app seeds itself a
# private season. It looks exactly like a first run. Half a config is worse
# than none, so the command lives in a file rather than in shell history.
#
# The values are dummies: the emulator does not check them.
#   sh scripts/build-firebase.sh <outDir> [extra vite args...]
set -e
OUT="${1:-dist-fb}"
shift 2>/dev/null || true
cd "$(dirname "$0")/.."
VITE_BACKEND=firebase \
VITE_FIREBASE_PROJECT_ID=demo-draftboard \
VITE_FIREBASE_API_KEY=emulator-not-checked \
VITE_FIREBASE_AUTH_DOMAIN=demo-draftboard.firebaseapp.com \
VITE_FIREBASE_APP_ID=1:0:web:emulator \
VITE_FIREBASE_EMULATOR=127.0.0.1:8080 \
  npx vite build --outDir "$OUT" "$@"
