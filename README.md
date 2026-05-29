# pgweb-My_games

A fork of [sosedoff/pgweb](https://github.com/sosedoff/pgweb) — a simple, cross-platform, web-based PostgreSQL database explorer — with **inline cell editing** added on top. 

This is a fork maintained for the [My_games](https://my-games.uk) project. 

## What this fork adds

- **Inline cell editing in the table rows view.** Double-click a cell to edit its value in place — `Enter` saves, `Shift+Enter` inserts a newline, `Esc` cancels. Saving runs a primary-key–scoped, parameterized `UPDATE`, so only the exact row is touched and values are cast to their own column types.
- Editing is available only while **browsing a table's rows** (not on arbitrary query results) and only for tables that have a **primary key**.
- The right-click cell menu carries the value actions: **Display Value** (the read-only viewer the double-click used to open), **Copy Value**, **Set NULL**, and **Filter Rows By Value**. 

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

The MIT License (MIT). See [LICENSE](LICENSE) for details. Original work done by Dan Sosedoff and the pgweb contributors.
