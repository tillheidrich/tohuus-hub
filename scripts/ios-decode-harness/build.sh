#!/bin/sh
# Decoding harness for the iOS app without Xcode: compiles the app's API client, models and the API extensions of the
# feature files (pulled out of the SwiftUI files by extract.mjs) with a Linux Swift toolchain, then calls every
# read-only API function – plus the scenarios in scenarios.swift – against a running server and decodes each answer
# with the app's own types. Reports decoding failures, list elements @Lossy silently dropped, optional properties that
# came out nil although the JSON had a value, and keys that collide after snake_case → camelCase conversion.
#
#   SWIFTC=/path/to/swift/usr/bin/swiftc scripts/ios-decode-harness/build.sh        → $OUT/harness (OUT default /tmp/ios-decode-harness)
#   BASE=http://localhost:8080 TOKEN=<app token> HH=<household id> [MUT=1 MUT2=1 MUT3=1] $OUT/harness
#
# MUT/MUT2/MUT3 run the writing scenarios – only against a scratch household (local dev server, demo data).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
IOS=$(cd "$HERE/../../ios" && pwd)
OUT=${OUT:-/tmp/ios-decode-harness}
SWIFTC=${SWIFTC:-swiftc}
rm -rf "$OUT/src"; mkdir -p "$OUT/src"
node "$HERE/extract.mjs" "$IOS" "$OUT"
for f in "$IOS"/ToHuus/Core/Models/*.swift $(ls "$IOS"/ToHuus/Core/API/*.swift | grep -v EventStream) "$IOS/Shared/Multipart.swift" \
         "$IOS/Shared/WidgetSnapshot.swift" "$IOS/Shared/SharedConfig.swift" "$IOS/ToHuus/Core/Offline/OpQueue.swift" \
         "$IOS/ToHuus/Core/Offline/QuickAddParser.swift" "$HERE/Stubs.swift" "$OUT/Extracted.swift"; do
  { echo "import FoundationNetworking"; cat "$f"; } > "$OUT/src/$(basename "$f")"
done
# instrument: @Lossy reports what it drops, every decoded answer goes through Audit
node -e '
const fs = require("fs"); const o = process.argv[1];
let s = fs.readFileSync(o + "/src/JSON.swift", "utf8");
s = s.replace("if let v = try? c.decode(T.self) { out.append(v) } else { _ = try? c.decode(JSONValue.self) }",
  "do { out.append(try c.decode(T.self)) } catch { print(\"LOSSY-DROP \\(T.self): \\(String(describing: error).prefix(500))\"); _ = try? c.decode(JSONValue.self) }");
fs.writeFileSync(o + "/src/JSON.swift", s);
let a = fs.readFileSync(o + "/src/APIClient.swift", "utf8");
a = a.replace("return try JSONCoding.decoder().decode(T.self, from: data)", "let v = try JSONCoding.decoder().decode(T.self, from: data); Audit.run(v, data); return v");
fs.writeFileSync(o + "/src/APIClient.swift", a);
' "$OUT"
cp "$HERE/Audit.swift" "$OUT/src/Audit.swift"
(cd "$OUT" && node "$HERE/gen.mjs" "$HERE/scenarios.swift")
"$SWIFTC" -swift-version 5 "$OUT"/src/*.swift -o "$OUT/harness"
echo "built $OUT/harness"
