# Forge

Forge is a local-first prototype builder based on the Forge V15 spec and bug report.

## Access

This project is intended to stay private while it is not ready for public release. The GitHub repository should be private. Do not enable public GitHub Pages unless you are ready for anyone with the URL to access it.

To run it locally:

```powershell
cd C:\Users\NEILDOSHI\Programming\Forge
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Scope Implemented

- Critical bug fixes for inspector tabs, arrow-key history, bottom toolbar tools, exported prototype CSS, and layer reorder layout.
- Significant fixes for device selector sync, selected icon updates, asset history payloads, upload limits, and context-menu bounds.
- Core editor additions: rotation, Shift aspect-ratio resize, distribute spacing, font family, shadows, persistent guides, clipboard persistence, Ctrl+P preview, Escape handling, and border controls.
- UX cleanup: current page status, theme swatches, safer inline editor selection, Firefox scrollbar styling, and roadmap updates.
- Export cleanup: one canonical HTML export path and a local uncompressed ZIP bundle.

## Security Notes

- The app uses no server, no login, and no cloud save.
- Client-side login is not used as the privacy boundary because it is not meaningful protection for a static site.
- Project data from imports and autosave is treated as untrusted and normalized before render/export.
- SVG image uploads are blocked, image uploads are capped at 1.5 MB, and undo history excludes base64 asset payloads.
- `index.html` includes a static-site CSP suitable for the current split-file app.
