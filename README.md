# Forge

Forge is a browser-based prototype builder for quickly sketching local app screens, dashboard flows, and clickable static demos. It is intentionally small, static, and local-first: the repository contains the tool, not user project data.

## What It Does

- Build screens on a canvas with common UI components, blueprints, pages, layers, and templates.
- Edit position, size, rotation, typography, fill, borders, shadows, opacity, and simple click actions.
- Move, resize, align, distribute, group, reorder, duplicate, copy, paste, and preview elements.
- Export editable project JSON, standalone prototype HTML, a current-page HTML file, or an uncompressed ZIP bundle.
- Keep project state in browser storage so work stays local to the user’s browser environment.

## Project Data

Forge does not include any saved user prototypes in this repository. Browser autosave, clipboard state, imported JSON, uploaded image assets, and exported files remain local to the user’s browser or download folder unless the user intentionally commits or uploads them elsewhere.

## Implementation

The app is a static frontend:

- `index.html` defines the shell and editor panels.
- `styles.css` contains the layout, responsive behavior, and visual system.
- `app.js` contains the editor state, rendering, history, import/export, QA, and interaction logic.

No backend, database, login system, cloud save, analytics script, or third-party runtime dependency is included.

## Safety Notes

- Imported project data is treated as untrusted and normalized before render/export.
- SVG uploads are blocked, raster image uploads are capped at 1.5 MB, and asset payloads are excluded from undo history snapshots.
- The exported prototype uses minimal CSS instead of copying Forge’s internal UI styles.
- A Content Security Policy is included for the static app shell.

## Status

Forge is an early local-first prototype builder. It is useful for fast mockups and demos, but it is not a production design system, collaborative editor, or cloud project manager.
