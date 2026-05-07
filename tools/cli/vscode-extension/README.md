# TrueCourse IL — VS Code extension

Syntax highlighting for `.tc` (TrueCourse Intent IL) files.

This extension is **not published to the marketplace**. It's bundled
inside the `truecourse` CLI and installed silently into the user's
local VS Code extensions directory the first time `truecourse analyze`
runs in a project that contains `.tc` files.

Install destinations covered:
- `~/.vscode/extensions/`
- `~/.vscode-insiders/extensions/`
- `~/.cursor/extensions/`
- `~/.windsurf/extensions/`

The extension is identified by its publisher + name + version
(`truecourse.tc-syntax-<version>`), so re-installs are idempotent and
old versions are cleaned up by the `syncShippedTcSyntax` helper.
