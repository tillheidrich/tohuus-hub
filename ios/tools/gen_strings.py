"""Builds ToHuus/Resources/Localizable.xcstrings from every L("…") / LF("…") key in the Swift sources and the German
translations in tools/strings_de.json. English is the key (same rule as the web app). Run after adding strings:
    python3 ios/tools/gen_strings.py            (prints keys without a German translation)
"""
import json, os, re, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pat = re.compile(r'\bLF?\(\s*"((?:[^"\\]|\\.)*)"')
keys = set()
for d in ["ToHuus", "ToHuusShare", "Shared"]:
    for dp, _, fs in os.walk(os.path.join(root, d)):
        for f in fs:
            if f.endswith(".swift"):
                for m in pat.finditer(open(os.path.join(dp, f), encoding="utf-8").read()):
                    keys.add(m.group(1).encode().decode("unicode_escape").encode("latin-1").decode("utf-8"))
# SignUpView form labels are passed through L(f.1)
for extra in ["Just me", "The two of us", "Family with children", "Flat share", "I look after someone"]:
    keys.add(extra)
de = json.load(open(os.path.join(root, "tools", "strings_de.json"), encoding="utf-8"))
missing = sorted(k for k in keys if k not in de)
strings = {}
for k in sorted(keys):
    e = {"extractionState": "manual", "localizations": {"en": {"stringUnit": {"state": "translated", "value": k}}}}
    if k in de:
        e["localizations"]["de"] = {"stringUnit": {"state": "translated", "value": de[k]}}
    strings[k] = e
out = {"sourceLanguage": "en", "strings": strings, "version": "1.0"}
json.dump(out, open(os.path.join(root, "ToHuus", "Resources", "Localizable.xcstrings"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"{len(keys)} keys, {len(missing)} without German")
for k in missing:
    print("MISSING:", json.dumps(k, ensure_ascii=False))
