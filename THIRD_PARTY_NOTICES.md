# Third-Party Notices

HTML Forge includes locally bundled open-source packages. The application has no runtime CDN dependency and no bundled user project data.

## GrapesJS

- Package: `grapesjs@0.23.2`
- License: BSD-3-Clause
- Source: https://github.com/GrapesJS/grapesjs
- Use: visual editing engine. HTML Forge initializes it with telemetry disabled and its built-in storage manager disabled.

## DOMPurify

- Package: `dompurify@3.4.8`
- License: Apache-2.0 OR MPL-2.0
- Source: https://github.com/cure53/DOMPurify
- Use: sanitization baseline for imported HTML, followed by HTML Forge explicit validation and reporting.

## idb

- Package: `idb@8.0.2`
- License: ISC
- Source: https://github.com/jakearchibald/idb
- Use: IndexedDB helper for local-only project and library storage.

## fflate

- Package: `fflate@0.8.2`
- License: MIT
- Source: https://github.com/101arrowz/fflate
- Use: local ZIP package export/import.

See `package-lock.json` for the exact resolved dependency tree.
