# pgweb-black

A fork of [sosedoff/pgweb](https://github.com/sosedoff/pgweb) — a simple, cross-platform, web-based PostgreSQL database explorer — with **inline cell editing** and a set of data-browsing conveniences added on top. 

Originally forked for the [My_games](https://my-games.uk) project. 

## What this fork adds

- **Inline cell editing in the table rows view.** Double-click a cell to edit its value in place — `Enter` saves, `Shift+Enter` inserts a newline, `Esc` cancels. Saving runs a primary-key–scoped, parameterized `UPDATE`, so only the exact row is touched and values are cast to their own column types.
- Editing is available only while **browsing a table's rows** (not on arbitrary query results) and only for tables that have a **primary key**.
- **Multi-row selection & bulk actions.** A select-all checkbox plus per-row checkboxes let you pick rows, then **delete the selection** or **export it** as CSV / JSON / XML from the toolbar's export-selected submenu.
- **JSON(B) tree viewer/editor.** Expand, browse, and edit `json` / `jsonb` cell values as a collapsible tree.
- **Foreign-key navigation.** A "Go to *table.column*" item in the row context menu jumps straight to the referenced row.
- **Copy Row as INSERT.** Right-click a row to copy a ready-to-run `INSERT` statement.
- **Client-side row filtering.** A "Filter rows" box filters the current page locally.
- **Precise query timing.** The Query page shows the real sub-millisecond server-side execution time, not a rounded one. 
- **Classic ↔ Office 98 themes.** Toggle between the classic look and a Windows-98–styled theme.

## Usage

```
pgweb --url postgres://user:password@host:port/database?sslmode=[mode]
```

Or with individual flags:

```
pgweb --host localhost --user myuser --db mydb
```

Inline editing issues `UPDATE` statements, so it needs a writable connection — running with `--readonly` (or a read-only bookmark) disables it.

## Building

Static assets are embedded via `go:embed`, so a plain Go build bundles the frontend too — no Node.js toolchain required. Requires Go 1.25+.

```
make build                                                  # current platform
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o pgweb .    # Linux server binary
```

Prebuilt binaries are published on the [Releases](https://github.com/blackkriger/pgweb-My_games/releases) page. 

## License

The MIT License (MIT). See [LICENSE](https://github.com/blackkriger/pgweb-My_games/blob/main/LICENSE) for details. Original work done by Dan Sosedoff and the pgweb contributors.
