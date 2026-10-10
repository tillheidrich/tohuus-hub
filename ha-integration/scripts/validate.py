#!/usr/bin/env python3
"""Light checks that run without Home Assistant installed (CI runs hassfest, HACS and pytest on top).

- every Python file compiles
- manifest.json / hacs.json / strings / translations are valid JSON with the expected keys
- strings.json and every translation have the same keys
- every service in services.yaml has a name in strings.json and is registered in services.py
"""

from __future__ import annotations

import json
from pathlib import Path
import py_compile
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
COMP = ROOT / "custom_components" / "tohuus_hub"
errors: list[str] = []


def keys(obj, prefix=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from keys(v, f"{prefix}.{k}" if prefix else k)
    else:
        yield prefix


for py in sorted(COMP.glob("*.py")) + sorted((ROOT / "tests").glob("*.py")) + [Path(__file__)]:
    try:
        py_compile.compile(str(py), doraise=True)
    except py_compile.PyCompileError as err:
        errors.append(f"{py.name}: {err.msg}")

manifest = json.loads((COMP / "manifest.json").read_text())
for k in ("domain", "name", "version", "documentation", "issue_tracker", "codeowners", "config_flow", "iot_class"):
    if k not in manifest:
        errors.append(f"manifest.json: missing {k}")
if manifest.get("domain") != "tohuus_hub":
    errors.append("manifest.json: domain must be tohuus_hub")
hacs = json.loads((ROOT / "hacs.json").read_text())
if "name" not in hacs:
    errors.append("hacs.json: missing name")

strings = json.loads((COMP / "strings.json").read_text())
ref = set(keys(strings))
for tr in sorted((COMP / "translations").glob("*.json")):
    got = set(keys(json.loads(tr.read_text())))
    if got != ref:
        errors.append(f"{tr.name}: differs from strings.json – missing {sorted(ref - got)[:5]}, extra {sorted(got - ref)[:5]}")

services_yaml = (COMP / "services.yaml").read_text()
services = re.findall(r"^([a-z_]+):\s*$", services_yaml, re.M)
services_py = (COMP / "services.py").read_text() + (COMP / "const.py").read_text()
for s in services:
    if s not in strings.get("services", {}):
        errors.append(f"services.yaml: {s} has no name in strings.json")
    if f'"{s}"' not in services_py:
        errors.append(f"services.yaml: {s} is not registered in services.py")

for png in ("icon.png", "logo.png"):
    if not (COMP / png).exists():
        errors.append(f"missing {png} (run scripts/render_brand.mjs)")

if errors:
    print("\n".join(f"✗ {e}" for e in errors))
    sys.exit(1)
print(f"✓ {len(list(COMP.glob('*.py')))} modules compile, {len(services)} services, translations in sync")
