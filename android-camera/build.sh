#!/usr/bin/env bash
# Builds Rhema Camera (the Android phone camera app, #209) with the Android SDK's own tools, no
# Gradle, like android-tv/build.sh. Needs a JDK 17 (JAVA_HOME or on PATH) and ANDROID_HOME with
# platforms;android-34 and build-tools;34.0.0. Out: android-camera/build/rhema-camera.apk, signed
# with a local debug key (~/.android/rhema-camera-debug.jks, made once).
# Install: adb install -r build/rhema-camera.apk
# First it runs CameraCoreCheck (test/) on this computer: the pairing link and certificate pin, RTP
# packets, the session description, Digest sign-in (RFC 2617's example), the picture plan, the
# looks' colour maths (the same as the GPU shader's), .cube tables, the film shutter's meter and
# the GPU's step-down when it is short of time, the battery and heat report; a
# failure stops the build.
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:?set ANDROID_HOME to the Android SDK}
BT=$SDK/build-tools/34.0.0
JAR=$SDK/platforms/android-34/android.jar
J=${JAVA_HOME:+$JAVA_HOME/bin/}
P=src/com/openbezal/rhema/camera
rm -rf build && mkdir -p build/classes build/dex build/gen build/check
# Plain Java parts only (no Android), checked with the computer's own Java.
"${J}javac" --release 8 -Xlint:-options -d build/check $P/Pairing.java $P/Rtp.java $P/Sdp.java $P/Auth.java $P/RtspReader.java $P/Plan.java $P/Kelvin.java $P/Looks.java $P/Lut.java $P/Exposure.java $P/Pace.java $P/Publisher.java $P/Report.java $(find test -name '*.java')
"${J}java" -cp build/check com.openbezal.rhema.camera.CameraCoreCheck
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link ${CAMERA_DEBUG:+--debug-mode} -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml --java build/gen build/res.zip
# Java 8 without lambdas: this android.jar has no LambdaMetafactory for javac's output.
"${J}javac" -source 8 -target 8 -bootclasspath "$JAR" -Xlint:-options -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
KS=$HOME/.android/rhema-camera-debug.jks
if [ ! -f "$KS" ]; then
  mkdir -p "$HOME/.android"
  "${J}keytool" -genkeypair -keystore "$KS" -storepass android -keypass android -alias debug -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Rhema Camera debug" >/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --out build/rhema-camera.apk build/aligned.apk
echo "built android-camera/build/rhema-camera.apk"
