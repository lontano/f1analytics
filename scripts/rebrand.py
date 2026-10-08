import re
from pathlib import Path

roots = [
    Path(r"d:\Projects\Gelosoft\F1analysis\F1Analytics\web\src"),
    Path(r"d:\Projects\Gelosoft\F1analysis\F1Analytics\web\public"),
    Path(r"d:\Projects\Gelosoft\F1analysis\F1Analytics\timing"),
]
exts = {".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".rs", ".toml", ".yaml", ".yml", ".md", ".html"}

import_subs = [
    (re.compile(r"""import\s+Image\s+from\s+["']next/image["'];?"""), 'import Image from "@/compat/image";'),
    (re.compile(r"""import\s+Link\s+from\s+["']next/link["'];?"""), 'import Link from "@/compat/link";'),
    (re.compile(r"""import\s+\{\s*usePathname\s*\}\s+from\s+["']next/navigation["'];?"""), 'import { usePathname } from "@/compat/navigation";'),
    (re.compile(r"""import\s+Script\s+from\s+["']next/script["'];?\n"""), ""),
    (re.compile(r"""import\s+\{[^}]*\}\s+from\s+["']next/headers["'];?\n"""), ""),
    (re.compile(r"""import\s+\{[^}]*\}\s+from\s+["']next/server["'];?\n"""), ""),
    (re.compile(r"""import\s+type\s+\{[^}]*\}\s+from\s+["']next["'];?\n"""), ""),
    (re.compile(r"""^\s*await connection\(\);\n""", re.M), ""),
]

text_subs = [
    ("https://f1-dash.com", "https://f1analytics.gelosoft.app"),
    ("https://github.com/slowlydev/f1-dash", "https://f1analytics.gelosoft.app"),
    ("https://github.com/sponsors/slowlydev", "https://f1analytics.gelosoft.app"),
    ("https://www.buymeacoffee.com/slowlydev", "https://f1analytics.gelosoft.app"),
    ("https://buymeacoffee.com/slowlydev", "https://f1analytics.gelosoft.app"),
    ("f1-dash.com", "f1analytics.gelosoft.app"),
    ("f1-dash", "F1 Analytics"),
    ("f1dash|", "f1a|"),
]

changed = 0
for root in roots:
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in exts:
            continue
        if "node_modules" in path.parts or "target" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        original = text
        if path.suffix in {".ts", ".tsx"}:
            for pattern, repl in import_subs:
                text = pattern.sub(repl, text)
        for old, new in text_subs:
            text = text.replace(old, new)
        if text != original:
            path.write_text(text, encoding="utf-8")
            changed += 1
print("updated", changed)
