#!/usr/bin/env bash
set -euo pipefail
# Required: Android SDK platform 35/build-tools 35, JDK 17+, zip; use your own signing key.
: "${ANDROID_SDK_ROOT:?Set Android SDK directory}"
tools="$ANDROID_SDK_ROOT/build-tools/35.0.0"
platform="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"
cd "$(dirname "$0")"
mkdir -p build/classes build/dex
"$tools/aapt2" compile --dir res -o build/resources.zip
"$tools/aapt2" link -o build/unsigned.apk -I "$platform" --manifest AndroidManifest.xml -A assets build/resources.zip
javac -source 8 -target 8 -cp "$platform" -d build/classes src/com/portfoliv/app/*.java
find build/classes -name '*.class' > build/classes.list
"$tools/d8" --lib "$platform" --min-api 26 --output build/dex @build/classes.list
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$tools/zipalign" -f 4 build/unsigned.apk build/aligned.apk
# apksigner sign --ks /private/path/key.p12 --out portfoliv.apk build/aligned.apk
