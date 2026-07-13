# Polarbear locale files

Each `*.properties` file in this directory is discovered automatically at build
time. Adding a language only requires adding one complete locale file, for
example `ar.properties`; no TypeScript registry or component changes are
needed.

Locale files use one `key=value` entry per line. Lines that begin with `#` or
`!` are comments. Escape a literal equals sign, newline, tab, or backslash with
`\\=`, `\\n`, `\\t`, or `\\\\`.

Every locale must include:

```properties
locale.name=Arabic
locale.direction=rtl
```

Use `en.properties` as the complete key baseline. Keep keys identical across
languages; the locale test verifies this automatically. Duplicate keys fail
parsing. `locale.direction` must be `ltr` or `rtl`; it updates the document
direction immediately when the user changes language.
