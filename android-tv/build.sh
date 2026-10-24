#!/usr/bin/env bash
# Builds Rhema Receiver (the Google TV / Android TV app, #198) with the Android SDK's own tools, no
# Gradle. Needs a JDK 17 (JAVA_HOME or on PATH) and ANDROID_HOME with platforms;android-34 and
# build-tools;34.0.0. Out: android-tv/build/rhema-receiver.apk, signed with a local debug key
# (~/.android/rhema-receiver-debug.jks, made once). Install: adb install -r build/rhema-receiver.apk
# RECEIVER_DEBUG=1 makes it debuggable, so chrome://inspect can read the page (WebRTC stats).
# First it runs CodeProofCheck (test/) on this computer: the code check and its refusals, against the
# same test vector Rhema's Rust tests use; a failure stops the build.
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:?set ANDROID_HOME to the Android SDK}
BT=$SDK/build-tools/34.0.0
JAR=$SDK/platforms/android-34/android.jar
J=${JAVA_HOME:+$JAVA_HOME/bin/}
rm -rf build && mkdir -p build/classes build/dex build/gen build/check
# Plain Java parts only (no Android), checked with the computer's own Java.
"${J}javac" --release 8 -Xlint:-options -d build/check src/com/openbezal/rhema/receiver/CodeProof.java src/com/openbezal/rhema/receiver/Guard.java $(find test -name '*.java')
"${J}java" -cp build/check com.openbezal.rhema.receiver.CodeProofCheck
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link ${RECEIVER_DEBUG:+--debug-mode} -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml --java build/gen build/res.zip
"${J}javac" -source 8 -target 8 -bootclasspath "$JAR" -Xlint:-options -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
KS=$HOME/.android/rhema-receiver-debug.jks
if [ ! -f "$KS" ]; then
  mkdir -p "$HOME/.android"
  "${J}keytool" -genkeypair -keystore "$KS" -storepass android -keypass android -alias debug -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Rhema Receiver debug" >/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --out build/rhema-receiver.apk build/aligned.apk
echo "built android-tv/build/rhema-receiver.apk"
