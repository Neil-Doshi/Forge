# HTML Forge

HTML Forge is a local-first production UI builder for importing existing HTML, converting it into editable product screens, building reusable UI, wiring page navigation, and exporting standalone ship-ready HTML.

The repository contains the tool only. Imported source files, editable projects, libraries, reports, assets, and exports remain in the user browser or download folder unless the user intentionally commits or uploads them elsewhere.

## What It Does

- Creates blank local projects and imports untrusted HTML through an inert analyzer.
- Converts imported screens into editable canvas elements, reusable components, assets, and page actions.
- Sanitizes HTML, quarantines scripts/handlers, strips editor-spoofing metadata, and neutralizes network-bearing CSS.
- Provides an editor-first workbench with a resizable canvas, pages, layers, insert tools, reusable UI, assets, themes, and inspector controls.
- Exports portable `.htmlforge.zip` backups, editable JSON, import reports, AI handoff bundles, and standalone product HTML with only approved runtime behavior.

## Local Development

```powershell
npm install
npm run dev
```

Production verification:

```powershell
npm test
npm run build
npm run preview
```

The app is static and deployable to GitHub Pages. `vite.config.ts` sets the `/Forge/` base path used by the public repository deployment.

## Privacy And Safety

HTML Forge has no backend, no cloud project save, no analytics, and no runtime CDN scripts. Browser persistence uses IndexedDB and optionally `navigator.storage.persist()`; it is durable local storage, not a guaranteed backup. Export portable project backups before clearing browser data or moving machines.

Imported scripts are never executed in analysis, safe import preview, editor canvas, or default export. Imported remote resources are blocked by default and listed in the import report for review.

## Licenses

Dependency decisions and license notices are tracked in `DEPENDENCY_REGISTER.md` and `THIRD_PARTY_NOTICES.md`.
