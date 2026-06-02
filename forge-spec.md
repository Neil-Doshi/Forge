# FORGE V15 — Complete Development Plan & Implementation Guide

> **Scope:** This document covers every identified bug, UX gap, and missing feature in the
> FORGE V15 single-file local prototype builder (`Forge.html`, 933 lines). Each item includes
> the exact location, the problem, a concrete fix or implementation approach, and acceptance
> criteria. Items are organized into five phases by priority and dependency order.

---

## Table of Contents

1. [Phase 1 — Critical Bug Fixes](#phase-1--critical-bug-fixes)
2. [Phase 2 — Significant Bug Fixes](#phase-2--significant-bug-fixes)
3. [Phase 3 — Missing Core Features](#phase-3--missing-core-features)
4. [Phase 4 — UX & UI Improvements](#phase-4--ux--ui-improvements)
5. [Phase 5 — Dead Code & Cleanup](#phase-5--dead-code--cleanup)
6. [Testing Checklist](#testing-checklist)

---

## Phase 1 — Critical Bug Fixes

These must be resolved before any feature work. They represent functionality that appears
to work but is silently broken or misleading to users.

---

### 1.1 Wire up the Inspector Tabs

**Location:** HTML line 190 (inspector-tabs div), JS `syncInspector()` function  
**Problem:** The three inspector tabs — Style, Settings, Actions — have no click handlers.
All inspector sections are always visible simultaneously. The "Settings" and "Actions" tabs
are purely decorative.

**Implementation:**

Step 1 — Group the inspector sections into three tab panels in the HTML. Wrap relevant
`inspector-section` divs with IDs:

```html
<!-- Replace the existing inspector-body content with this structure -->
<div class="inspector-body">

  <!-- TAB: Style (always show Position + Text + Style) -->
  <div id="inspTab-style">
    <div class="inspector-section"> <!-- Position --> ... </div>
    <div class="inspector-section"> <!-- Text --> ... </div>
    <div class="inspector-section"> <!-- Style --> ... </div>
  </div>

  <!-- TAB: Settings (Canvas + Options) -->
  <div id="inspTab-settings" style="display:none">
    <div class="inspector-section"> <!-- Canvas --> ... </div>
    <div class="inspector-section"> <!-- Options --> ... </div>
  </div>

  <!-- TAB: Actions (Behavior) -->
  <div id="inspTab-actions" style="display:none">
    <div class="inspector-section"> <!-- Behavior --> ... </div>
  </div>

</div>
```

Step 2 — Add the click handler after the existing `.tab` handler block:

```javascript
document.querySelectorAll('.inspector-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.inspector-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const panel = btn.dataset.inspPanel;
    ['style', 'settings', 'actions'].forEach(p => {
      const el = document.getElementById('inspTab-' + p);
      if (el) el.style.display = p === panel ? 'block' : 'none';
    });
  });
});
```

Step 3 — Add `data-insp-panel` attributes to the tab buttons:

```html
<button class="inspector-tab active" data-insp-panel="style">Style</button>
<button class="inspector-tab" data-insp-panel="settings">Settings</button>
<button class="inspector-tab" data-insp-panel="actions">Actions</button>
```

**Acceptance criteria:**
- Clicking Settings hides Position/Text/Style sections and shows Canvas/Options only
- Clicking Actions shows only the Behavior section
- Active tab state persists until another tab is clicked
- `syncInspector()` does not reset the active tab on re-render

---

### 1.2 Save Arrow-Key Moves to History

**Location:** `window.addEventListener('keydown', ...)`, line 334  
**Problem:** Arrow-key element movement calls `render()` but never `saveHist()`. Any
positioning done exclusively with arrow keys is lost on reload or after the next undo.

**Current code (end of arrow key block):**
```javascript
arr.forEach(el => { ... });
render()
```

**Fix — add debounced history save:**

```javascript
// Add this near the top of the script, alongside other state variables
let arrowSaveTimer = null;

// Inside the arrow key block, replace `render()` with:
arr.forEach(el => {
  if (el.locked) return;
  if (e.key === 'ArrowUp')    el.y -= step;
  if (e.key === 'ArrowDown')  el.y += step;
  if (e.key === 'ArrowLeft')  el.x -= step;
  if (e.key === 'ArrowRight') el.x += step;
});
render();
// Debounce saves so holding a key doesn't flood history
clearTimeout(arrowSaveTimer);
arrowSaveTimer = setTimeout(() => saveHist(), 400);
```

**Acceptance criteria:**
- Moving an element with arrow keys then reloading preserves the position
- Holding down an arrow key for 2 seconds creates exactly one history entry, not dozens
- Ctrl+Z after arrow-key moves correctly restores the previous position

---

### 1.3 Fix or Remove the Non-Functional Bottom Toolbar Buttons

**Location:** HTML line 186, `.bottom-tools` div  
**Problem:** The hand (✋), search (⌕), and frame (⧉) tool buttons have no event listeners.
They look interactive and highlight on hover but do nothing on click.

**Option A — Implement them (recommended):**

```javascript
// Track current tool in state
state.currentTool = 'select'; // add to initial state object

const toolButtons = document.querySelectorAll('.tool-square');

toolButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    toolButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tool = btn.dataset.tool;
    state.currentTool = tool;

    // Hand tool: enable workspace pan on drag
    work.style.cursor = tool === 'hand' ? 'grab' : 'default';

    // Update canvas mouse behaviour
    if (tool === 'hand') {
      enablePanMode();
    } else {
      disablePanMode();
    }
  });
});

function enablePanMode() {
  work.addEventListener('mousedown', startPan);
}
function disablePanMode() {
  work.removeEventListener('mousedown', startPan);
}
function startPan(e) {
  const startX = e.clientX + work.scrollLeft;
  const startY = e.clientY + work.scrollTop;
  work.style.cursor = 'grabbing';
  function onMove(ev) {
    work.scrollLeft = startX - ev.clientX;
    work.scrollTop  = startY - ev.clientY;
  }
  function onUp() {
    work.style.cursor = 'grab';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
```

Add `data-tool` attributes to the HTML:
```html
<button class="tool-square active" data-tool="select">⌖</button>
<button class="tool-square" data-tool="hand">✋</button>
<button class="tool-square" data-tool="zoom">⌕</button>
<button class="tool-square" data-tool="frame">⧉</button>
```

**Option B — Remove the three unused buttons** if pan-mode is out of scope, so users
aren't confused by broken affordances.

**Acceptance criteria:**
- Every visible button either responds to a click or is removed from the DOM
- Hand tool activates pan mode; cursor changes to grab; workspace scrolls on drag

---

### 1.4 Strip FORGE-Internal CSS from the Exported Prototype HTML

**Location:** `betterExportHtml()`, lines 472–492  
**Problem:** The function copies the entire FORGE application stylesheet — including `.qa-table`,
`.guide-section`, `.health-chip`, and dozens of other internal classes — into every exported
prototype. These classes reference CSS variables (e.g. `var(--line)`, `var(--muted)`) that
are never defined in the exported file, producing broken styles.

**Fix — replace the inline `<style>` block in `betterExportHtml()` with a minimal set:**

```javascript
function betterExportHtml() {
  const minimalCss = `
    * { box-sizing: border-box; }
    body { margin: 0; background: #111; font-family: Inter, Segoe UI, sans-serif; }
    .page { position: relative; margin: 40px auto; overflow: hidden; display: none; }
    .page.active { display: block; }
  `;

  const pages = state.pages.map((pg, i) => {
    const els = pg.elements.filter(e => !e.hidden).map(el =>
      `<div data-name="${esc(el.name)}"
            data-action="${el.action || ''}"
            data-target="${esc(el.target || '')}"
            style="position:absolute;left:${el.x}px;top:${el.y}px;
                   width:${el.w}px;height:${el.h}px;
                   display:flex;align-items:center;justify-content:center;
                   background:${el.assetData ? `url(${el.assetData}) center/cover` : el.fill};
                   color:${el.color};border-radius:${el.radius}px;
                   font-size:${el.font}px;font-weight:${el.weight};
                   opacity:${el.opacity / 100};
                   border:${el.fill === 'transparent' ? 0 : `${el.borderWidth || 1}px solid ${el.border || '#cbd5e1'}`};
                   white-space:pre-wrap;padding:8px;box-sizing:border-box">
        ${esc(el.text)}
      </div>`
    ).join('');
    return `<section class="page${i === 0 ? ' active' : ''}"
                     data-page="${esc(pg.name)}"
                     style="width:${pg.width}px;height:${pg.height}px;
                            background:${pg.background || '#fff'}">${els}</section>`;
  }).join('');

  const navScript = `
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const { action, target } = el.dataset;
      if (action === 'page') {
        document.querySelectorAll('.page').forEach(p => {
          p.classList.toggle('active', p.dataset.page === target);
        });
      }
      if (action === 'toggle' || action === 'modal') {
        const t = [...document.querySelectorAll('[data-name]')]
          .find(x => x.dataset.name === target);
        if (t) t.style.display = t.style.display === 'none' ? 'flex' : 'none';
      }
    });
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(state.project.name || 'FORGE Prototype')}</title>
  <style>${minimalCss}</style>
</head>
<body>${pages}<script>${navScript}<\/script></body>
</html>`;
}
```

**Acceptance criteria:**
- Exported HTML validates in the W3C validator with no undefined variable warnings
- Page navigation still works in the exported file
- File size of the export is reduced (no ~4 KB of dead styles)

---

### 1.5 Fix Layer Panel Reorder Button Layout

**Location:** `renderLayers` override, lines 583–598  
**Problem:** The override appends ↑ and ↓ buttons to each row after `originalRenderLayers()`
already built the row with `grid-template-columns: auto 1fr auto`. The extra buttons fall
into implicit 4th/5th grid columns, wrapping onto a new row and breaking the layout.

**Fix — rewrite the layer row construction in one pass. Remove the override entirely and
update `originalRenderLayers` directly:**

```javascript
// Replace the entire renderLayers function (and the override block below it)
function renderLayers() {
  const box = document.getElementById('layersList');
  box.innerHTML = '';
  [...els()].reverse().forEach((el, visIdx) => {
    const row = document.createElement('div');
    row.className = 'row-item layer-row-drag' + (state.selected.includes(el.id) ? ' active' : '');

    // visibility toggle
    const eyeBtn = document.createElement('button');
    eyeBtn.textContent = el.hidden ? '🙈' : '👁';
    eyeBtn.onclick = () => { el.hidden = !el.hidden; saveHist(); render(); };

    // name input
    const nameInput = document.createElement('input');
    nameInput.value = esc(el.name);
    nameInput.onchange = e => { el.name = e.target.value; saveHist(); render(); };

    // select button
    const selBtn = document.createElement('button');
    selBtn.textContent = el.locked ? '🔒' : '↗';
    selBtn.onclick = () => { state.selected = [el.id]; render(); };

    // reorder buttons — included in the same row from the start
    const upBtn  = document.createElement('button');
    const dnBtn  = document.createElement('button');
    upBtn.textContent  = '↑';
    dnBtn.textContent  = '↓';
    upBtn.onclick = () => reorderElement(el.id, 1);
    dnBtn.onclick = () => reorderElement(el.id, -1);

    row.appendChild(eyeBtn);
    row.appendChild(nameInput);
    row.appendChild(selBtn);
    row.appendChild(upBtn);
    row.appendChild(dnBtn);
    box.appendChild(row);
  });
}
```

Update `.row-item` CSS to accommodate 5 columns:

```css
.row-item {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  gap: 6px;
  align-items: center;
  /* rest unchanged */
}
```

**Acceptance criteria:**
- All 5 cells (eye, name, select, up, down) appear in a single row with no wrapping
- Up/down arrows correctly change element stacking order
- Row is fully re-rendered on every `render()` call with no duplicated buttons

---

## Phase 2 — Significant Bug Fixes

These are functional gaps that will surprise users but don't cause silent data loss.

---

### 2.1 Synchronize the Two Device / Canvas Size Selectors

**Location:** `setDevice()` function (~line 321), `document.getElementById('device').onchange`  
**Problem:** The toolbar `#device` dropdown and inspector `#canvasSize` dropdown both call
`setDevice()` but neither updates the other. They go out of sync immediately.

**Fix — update both selects at the end of `setDevice()`:**

```javascript
function setDevice(v) {
  const pg = page();
  if (v === 'free') return;
  const sizes = {
    desktop: { w: 1200, h: 800  },
    tablet:  { w: 768,  h: 900  },
    mobile:  { w: 375,  h: 812  }
  };
  if (sizes[v]) {
    pg.width  = sizes[v].w;
    pg.height = sizes[v].h;
  }
  // Keep both selects in sync
  document.getElementById('device').value     = v;
  document.getElementById('canvasSize').value = v;
  document.getElementById('canvasW').value    = pg.width;
  document.getElementById('canvasH').value    = pg.height;
  saveHist();
  render();
}
```

**Acceptance criteria:**
- Changing device from the toolbar immediately reflects in the inspector select and vice versa
- Custom W/H values entered in the inspector update both selects to "Freeform" (or leave
  them blank if no freeform option exists)

---

### 2.2 Update the Selected Element Icon in the Inspector

**Location:** `syncInspector()` function (~line 298), HTML `#selectedIcon` element  
**Problem:** `#selectedIcon` always displays `▢` regardless of element type. It never
updates when an element is selected.

**Fix — add an icon map and update the element in `syncInspector()`:**

```javascript
const typeIcons = {
  container: '▢', text: 'T', button: '▭', image: '▧', icon: '☆',
  shape: '◇', line: '─', input: '▭', textarea: '▣', dropdown: '⌄',
  checkbox: '☑', radio: '○', toggle: '●', tabs: '▥', modal: '▣',
  alert: '!', progress: '▰', table: '▦', header: '▤', navbar: '▭',
  sidebar: '▥', card: '▣', footer: '▱', grid: '▦'
};

function syncInspector() {
  const el = selected()[0];
  const single = state.selected.length === 1;
  document.getElementById('selectedName').textContent =
    single ? el.type : (state.selected.length ? state.selected.length + ' elements' : 'No element selected');
  document.getElementById('selectedHelp').textContent =
    single ? 'Edit properties below.' : 'Select an element to edit.';

  // Update icon
  document.getElementById('selectedIcon').textContent =
    single ? (typeIcons[el.type] || '▢') : '▢';

  Object.keys(map).forEach(id => document.getElementById(id).disabled = !single);
  if (!single) return;
  for (const [id, k] of Object.entries(map))
    setVal(id, (k === 'fill' || k === 'color') ? norm(el[k]) : el[k]);
}
```

**Acceptance criteria:**
- Selecting a Text element shows `T` in the icon area
- Selecting a Button shows `▭`
- Selecting multiple elements shows `▢` (generic)

---

### 2.3 Exclude Asset Data from History Snapshots

**Location:** `exportProjectObject()` line 274, `pushHistory()` line 344  
**Problem:** `state.assets` (which may contain multiple large base64 data URLs) is serialized
into every history snapshot. With 150 history entries and even a single 500 KB image, this
creates ~75 MB of RAM usage just for undo history.

**Fix — snapshot asset IDs only; store asset data separately outside the history stack:**

```javascript
// In exportProjectObject(), replace the assets line:
function exportProjectObject() {
  return {
    version: '1.0.0',
    project: state.project,
    settings: { grid: state.grid, snap: state.snap, gridSize: state.gridSize },
    theme: { /* unchanged */ },
    assets: state.assets.map(a => ({ id: a.id, name: a.name })), // IDs only — no data
    pages: state.pages,
    templates: state.templates,
    current: state.current,
    id: state.id
  };
}

// Add a separate save for asset data that bypasses the history stack:
function saveAssets() {
  try {
    localStorage.setItem('forge-v15-assets', JSON.stringify(state.assets));
  } catch(e) {
    toast('Asset storage full — delete some assets');
  }
}

// In loadProjectObject(), restore assets separately:
function loadProjectObject(d) {
  state.project   = d.project   || state.project;
  state.pages     = d.pages     || state.pages;
  state.templates = d.templates || [];
  state.current   = d.current   || state.pages[0].id;
  state.id        = d.id        || state.id;
  state.grid      = d.settings?.grid  ?? state.grid;
  state.snap      = d.settings?.snap  ?? state.snap;
  // Assets: merge saved asset data back in using IDs
  const savedAssets = JSON.parse(localStorage.getItem('forge-v15-assets') || '[]');
  state.assets = (d.assets || []).map(stub =>
    savedAssets.find(a => a.id === stub.id) || stub
  );
}
```

**Acceptance criteria:**
- Each history entry is noticeably smaller (no base64 strings)
- Undo/redo preserves element positions and styles; asset visuals still render correctly
- Uploading a 1 MB image no longer causes memory to spike with every subsequent action

---

### 2.4 Add File Size Limit to Asset Uploads

**Location:** `document.getElementById('assetFileInput').onchange`, line 763  
**Problem:** No file size validation. A large photo can exceed localStorage quota, causing
autosave to silently fail for all subsequent actions.

**Fix:**

```javascript
document.getElementById('assetFileInput').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;

  const MAX_MB = 1.5;
  if (f.size > MAX_MB * 1024 * 1024) {
    toast(`Image too large (max ${MAX_MB} MB). Resize it first.`);
    e.target.value = '';
    return;
  }

  const r = new FileReader();
  r.onload = () => {
    state.assets.push({ id: 'asset_' + Date.now(), name: f.name, data: r.result });
    saveAssets(); // separate from history
    renderAssets();
    toast('Asset added locally');
  };
  r.readAsDataURL(f);
};
```

**Acceptance criteria:**
- Files over 1.5 MB show a clear toast error and are not added
- Files under 1.5 MB upload normally
- The file input is reset after a rejection so the same file can be re-selected after resizing

---

### 2.5 Add Viewport Edge Detection to the Context Menu

**Location:** `openCtx()` function, line 290  
**Problem:** The context menu is positioned at the raw mouse coordinates with no check
against the viewport edges, causing it to render off-screen near the bottom or right edges.

**Fix:**

```javascript
function openCtx(e) {
  e.preventDefault();
  if (!state.selected.includes(e.currentTarget.dataset.id))
    state.selected = [e.currentTarget.dataset.id];
  render();

  ctx.style.display = 'block';

  // Measure after making visible but before positioning
  const menuW = ctx.offsetWidth  || 190;
  const menuH = ctx.offsetHeight || 300;

  const x = Math.min(e.clientX, window.innerWidth  - menuW - 8);
  const y = Math.min(e.clientY, window.innerHeight - menuH - 8);

  ctx.style.left = x + 'px';
  ctx.style.top  = y + 'px';
}
```

**Acceptance criteria:**
- Right-clicking any element near any screen edge keeps the entire menu visible
- Menu always appears adjacent to the cursor, never off-screen

---

## Phase 3 — Missing Core Features

These are features that comparable prototyping tools offer and users will expect.
Implement in the order listed; each builds on the previous.

---

### 3.1 Element Rotation

**Why it's critical:** Rotation is one of the most fundamental canvas operations. Without it,
diagonal lines, angled cards, badges, and decorative shapes are impossible to create.

**Data model change — add `rotation` field to element creation in `add()`:**

```javascript
// In add(), inside the el object:
const el = {
  id: uid(), type, name: type + ' ' + state.id,
  parent: null, children: [],
  x: snap(x), y: snap(y), w: d.w, h: d.h,
  rotation: 0,   // ← new field
  text: d.text, fill: d.fill, color: d.color,
  border: '#cbd5e1', borderWidth: 1,
  radius: d.radius, font: d.font, weight: d.weight,
  opacity: 100, locked: false, hidden: false,
  action: '', target: '',
  ...extra
};
```

**Render — apply CSS transform:**

```javascript
// In render(), after setting n.style.height:
n.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
n.style.transformOrigin = 'center center';
```

**Inspector — add rotation field in the Position section:**

```html
<!-- Add to the form-row in the Position inspector-section -->
<div class="field">
  <label>Rotate °</label>
  <input id="propRotation" type="number" min="-180" max="180">
</div>
```

```javascript
// Add to the map object:
const map = {
  propX: 'x', propY: 'y', propW: 'w', propH: 'h',
  propRotation: 'rotation',   // ← add this
  /* rest unchanged */
};
```

**Migration — ensure old elements get rotation:0:**

```javascript
// In migrateProject(), inside the el loop:
el.rotation = Number(el.rotation ?? 0);
```

**Acceptance criteria:**
- Setting rotation to 45° in the inspector visually rotates the element on the canvas
- Rotation is preserved through save/load cycles
- Rotated elements can still be selected, moved, and resized

---

### 3.2 Shift-to-Lock Aspect Ratio During Resize

**Why it's critical:** Without aspect ratio locking, images and icons distort freely during
resize. This is expected behavior in every design tool.

**Location:** `startResize()` and the `mousemove` resize block, lines 282–283

**Fix — track original aspect ratio and enforce it when Shift is held:**

```javascript
// In startResize(), store the ratio:
function startResize(e) {
  const el = selected()[0];
  if (!el || el.locked) return;
  state.drag = {
    kind: 'resize',
    id: el.id,
    handle: e.target.dataset.handle,
    start: point(e),
    orig: { ...el },
    ratio: el.w / el.h   // ← store original aspect ratio
  };
  e.stopPropagation();
  e.preventDefault();
}

// In the mousemove resize block, after computing w and h:
if (e.shiftKey && state.drag.ratio) {
  // Determine which axis is primary based on the handle direction
  const ha = state.drag.handle;
  if (ha === 'se' || ha === 'nw') {
    // Corner: use width as primary
    h = w / state.drag.ratio;
  } else if (ha === 'ne' || ha === 'sw') {
    h = w / state.drag.ratio;
  } else if (ha === 'e' || ha === 'w') {
    h = w / state.drag.ratio;
  } else {
    w = h * state.drag.ratio;
  }
}
el.w = Math.max(12, snap(w));
el.h = Math.max(12, snap(h));
```

**Acceptance criteria:**
- Holding Shift while dragging any resize handle maintains the original W:H ratio
- Releasing Shift mid-drag allows free resize again
- Works correctly for all 8 handles

---

### 3.3 Distribute Spacing

**Why it's critical:** The align panel has Left/Center/Right/Top/Middle/Bottom but no
distribute. Evenly spacing a row of cards or icons is the most common multi-element operation
after alignment.

**Add two buttons to the align-tools grid in the inspector HTML:**

```html
<!-- Add to the align-tools div after the existing 6 buttons -->
<button class="mini-btn" data-align="distH" title="Distribute Horizontally">⇼H</button>
<button class="mini-btn" data-align="distV" title="Distribute Vertically">⇼V</button>
```

**Add distribute logic to the `align()` function:**

```javascript
function align(a) {
  const arr = selected();
  if (arr.length < 2) return;

  const minX = Math.min(...arr.map(e => e.x));
  const maxX = Math.max(...arr.map(e => e.x + e.w));
  const minY = Math.min(...arr.map(e => e.y));
  const maxY = Math.max(...arr.map(e => e.y + e.h));

  // Existing alignment cases
  arr.forEach(e => {
    if (a === 'left')   e.x = minX;
    if (a === 'right')  e.x = maxX - e.w;
    if (a === 'center') e.x = minX + (maxX - minX - e.w) / 2;
    if (a === 'top')    e.y = minY;
    if (a === 'bottom') e.y = maxY - e.h;
    if (a === 'middle') e.y = minY + (maxY - minY - e.h) / 2;
  });

  // Distribute horizontally: sort by x, then space evenly
  if (a === 'distH' && arr.length >= 3) {
    const sorted = [...arr].sort((a, b) => a.x - b.x);
    const totalW = sorted.reduce((s, e) => s + e.w, 0);
    const gap    = (maxX - minX - totalW) / (sorted.length - 1);
    let cursor   = minX;
    sorted.forEach(e => {
      e.x = Math.round(cursor);
      cursor += e.w + gap;
    });
  }

  // Distribute vertically
  if (a === 'distV' && arr.length >= 3) {
    const sorted = [...arr].sort((a, b) => a.y - b.y);
    const totalH = sorted.reduce((s, e) => s + e.h, 0);
    const gap    = (maxY - minY - totalH) / (sorted.length - 1);
    let cursor   = minY;
    sorted.forEach(e => {
      e.y = Math.round(cursor);
      cursor += e.h + gap;
    });
  }

  saveHist();
  render();
}
```

**Acceptance criteria:**
- Selecting 3+ elements and clicking Distribute H places equal gaps between them
- Distributing 2 elements shows a toast: "Select 3+ elements to distribute"
- Distributed positions are saved to history and undoable

---

### 3.4 Font Family Selection Per Element

**Data model — add `fontFamily` to element creation:**

```javascript
// In add(), add to the el object:
fontFamily: d.fontFamily || 'Inter, Segoe UI, sans-serif',

// In defs, set sensible defaults (can be the same for all for now):
// Each def can later specify its own family
```

**Render — apply to el-content:**

```javascript
// In render(), after setting c.style.fontWeight:
c.style.fontFamily = el.fontFamily || 'Inter, Segoe UI, sans-serif';
```

**Inspector — add a font family select in the Text section:**

```html
<div class="field">
  <label>Font Family</label>
  <select id="propFontFamily">
    <option value="Inter, Segoe UI, sans-serif">Inter (default)</option>
    <option value="Georgia, serif">Georgia</option>
    <option value="'Courier New', monospace">Courier New</option>
    <option value="system-ui, sans-serif">System UI</option>
    <option value="'Arial Black', sans-serif">Arial Black</option>
    <option value="Impact, sans-serif">Impact</option>
  </select>
</div>
```

```javascript
// Add to the map:
propFontFamily: 'fontFamily',
```

**Migration:**
```javascript
el.fontFamily = el.fontFamily || 'Inter, Segoe UI, sans-serif';
```

**Acceptance criteria:**
- Changing font family in the inspector updates the canvas element immediately
- Font family is preserved through save/load

---

### 3.5 Box Shadow Support

**Data model — add `shadow` field:**

```javascript
// In add():
shadow: '',   // e.g. '0 4px 16px rgba(0,0,0,0.15)'
```

**Render:**
```javascript
// In render(), after setting opacity:
n.style.boxShadow = el.shadow || '';
```

**Inspector — add shadow field in the Style section:**

```html
<div class="field">
  <label>Shadow</label>
  <select id="propShadow">
    <option value="">None</option>
    <option value="0 1px 3px rgba(0,0,0,0.12)">Subtle</option>
    <option value="0 4px 16px rgba(0,0,0,0.15)">Medium</option>
    <option value="0 12px 40px rgba(0,0,0,0.25)">Strong</option>
    <option value="0 24px 80px rgba(0,0,0,0.45)">Deep</option>
  </select>
</div>
```

```javascript
// Add to map:
propShadow: 'shadow',
```

**Acceptance criteria:**
- Selecting a shadow preset adds the drop shadow to the canvas element
- "None" removes the shadow
- Shadow is exported in the prototype HTML

---

### 3.6 Persistent Ruler Guides

**Why:** The guide lines already exist in the DOM (`#guideV`, `#guideH`) and appear during
smart snap. Users expect to be able to click the ruler to drop a permanent guide.

**Data model — add `guides` to state:**

```javascript
// In the initial state object:
state.guides = { x: [], y: [] };  // arrays of pixel positions
```

**Ruler click handler:**

```javascript
rulerTop.addEventListener('click', e => {
  const rect = rulerTop.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) / state.zoom);
  state.guides.x.push(x);
  renderGuides();
  saveHist();
});

rulerLeft.addEventListener('click', e => {
  const rect = rulerLeft.getBoundingClientRect();
  const y = Math.round((e.clientY - rect.top) / state.zoom);
  state.guides.y.push(y);
  renderGuides();
  saveHist();
});
```

**Render guides function:**

```javascript
function renderGuides() {
  // Remove old persistent guide elements
  document.querySelectorAll('.pguide').forEach(g => g.remove());
  const cr = canvas.getBoundingClientRect();

  state.guides.x.forEach(x => {
    const g = document.createElement('div');
    g.className = 'guide v pguide';
    g.style.left = (cr.left + x * state.zoom) + 'px';
    g.style.display = 'block';
    // Double-click to remove
    g.addEventListener('dblclick', () => {
      state.guides.x = state.guides.x.filter(v => v !== x);
      renderGuides(); saveHist();
    });
    document.body.appendChild(g);
  });

  state.guides.y.forEach(y => {
    const g = document.createElement('div');
    g.className = 'guide h pguide';
    g.style.top = (cr.top + y * state.zoom) + 'px';
    g.style.display = 'block';
    g.addEventListener('dblclick', () => {
      state.guides.y = state.guides.y.filter(v => v !== y);
      renderGuides(); saveHist();
    });
    document.body.appendChild(g);
  });
}
```

Call `renderGuides()` at the end of `render()`. Include `guides` in `exportProjectObject()`
and restore it in `loadProjectObject()`.

**Acceptance criteria:**
- Clicking the top ruler drops a vertical guide line at that X position
- Clicking the left ruler drops a horizontal guide line
- Double-clicking a guide removes it
- Guides persist through save/load cycles
- Guides are not included in exported HTML prototypes

---

### 3.7 Clipboard Persistence Across Sessions

**Location:** `window.addEventListener('keydown', ...)` — Ctrl+C handler  
**Problem:** `state.clipboard` is in-memory only. Copying elements and reloading the page
loses the clipboard.

**Fix:**

```javascript
// In the Ctrl+C handler, after copying to state.clipboard:
if (e.ctrlKey && e.key.toLowerCase() === 'c') {
  state.clipboard = selected().map(el => ({ ...el }));
  try {
    localStorage.setItem('forge-v15-clipboard', JSON.stringify(state.clipboard));
  } catch(err) { /* quota exceeded — silent */ }
}

// On startup, after migrateLegacyAutosave():
try {
  const saved = localStorage.getItem('forge-v15-clipboard');
  if (saved) state.clipboard = JSON.parse(saved);
} catch(err) { /* ignore */ }
```

**Acceptance criteria:**
- Copying elements, reloading the page, then pressing Ctrl+V pastes the copied elements
- Clipboard survives browser tab close and reopen

---

### 3.8 Keyboard Shortcut for Preview Toggle

**Why:** Preview is one of the most frequent mode switches. Having it require a toolbar click
every time is friction.

**Fix — add to the keydown handler:**

```javascript
// After the existing Ctrl+A handler:
if (e.ctrlKey && e.key.toLowerCase() === 'p') {
  e.preventDefault();
  document.getElementById('previewBtn').click();
}
```

**Add to the Shortcuts modal HTML:**
```html
<div><span>Preview</span><b>Ctrl+P</b></div>
```

**Acceptance criteria:**
- Ctrl+P toggles Preview mode on and off
- The toolbar Preview button state stays in sync
- The shortcut is listed in the Shortcuts modal

---

### 3.9 Escape Key Handler

**Fix — add to the top of the keydown handler:**

```javascript
if (e.key === 'Escape') {
  // Deselect all
  state.selected = [];
  // Exit preview mode
  if (state.preview) {
    state.preview = false;
    document.getElementById('previewBtn').classList.remove('active');
    toast('Editor mode');
  }
  // Close any open context menu
  ctx.style.display = 'none';
  render();
  return;
}
```

**Acceptance criteria:**
- Pressing Escape deselects all selected elements
- Pressing Escape in Preview mode exits to editor mode
- The Shortcuts modal lists Escape as "Deselect / Exit Preview"

---

### 3.10 Border Style Control

**Data model — add `borderStyle` to `add()`:**

```javascript
borderStyle: 'solid',   // 'solid' | 'dashed' | 'dotted' | 'none'
```

**Render — update border construction:**

```javascript
c.style.border = el.fill === 'transparent' || el.borderStyle === 'none'
  ? '0'
  : `${el.borderWidth || 1}px ${el.borderStyle || 'solid'} ${el.border || '#cbd5e1'}`;
```

**Inspector — add a border style select and border color/width inputs in the Style section:**

```html
<div class="form-row">
  <div class="field">
    <label>Border</label>
    <select id="propBorderStyle">
      <option value="solid">Solid</option>
      <option value="dashed">Dashed</option>
      <option value="dotted">Dotted</option>
      <option value="none">None</option>
    </select>
  </div>
  <div class="field">
    <label>Border color</label>
    <input id="propBorderColor" type="color">
  </div>
</div>
```

```javascript
// Add to map:
propBorderStyle: 'borderStyle',
propBorderColor: 'border',
```

**Acceptance criteria:**
- Dashed and dotted borders render correctly on the canvas
- "None" removes the border entirely (does not render a 0px solid border)
- Border color picker changes the border color independently of the fill

---

## Phase 4 — UX & UI Improvements

These don't fix bugs but significantly improve the day-to-day experience.

---

### 4.1 Show Context-Appropriate Inspector Sections Only

**Problem:** Every element type shows all six inspector sections, including irrelevant ones
(a Line showing font weight; a Container showing the text content area).

**Implementation — define a section visibility map and apply it in `syncInspector()`:**

```javascript
const sectionVisibility = {
  // [showPosition, showText, showStyle, showBehavior]
  text:      [true,  true,  true,  true ],
  button:    [true,  true,  true,  true ],
  container: [true,  false, true,  true ],
  image:     [true,  false, true,  true ],
  icon:      [true,  true,  true,  true ],
  shape:     [true,  false, true,  true ],
  line:      [true,  false, true,  false],
  input:     [true,  true,  true,  false],
  textarea:  [true,  true,  true,  false],
  toggle:    [true,  true,  true,  true ],
  // Default: show everything
};

// In syncInspector(), after early-return guard:
if (single && el) {
  const vis = sectionVisibility[el.type] || [true, true, true, true];
  const sections = ['sectionPosition','sectionText','sectionStyle','sectionBehavior'];
  sections.forEach((id, i) => {
    const sec = document.getElementById(id);
    if (sec) sec.style.display = vis[i] ? '' : 'none';
  });
}
```

Add IDs to the inspector section divs:
```html
<div class="inspector-section" id="sectionPosition">
<div class="inspector-section" id="sectionText">
<div class="inspector-section" id="sectionStyle">
<div class="inspector-section" id="sectionBehavior">
```

---

### 4.2 Display Current Page Name in the Status Bar

```javascript
// In the counts() function, add:
function counts() {
  document.getElementById('countBottom').textContent = 'Elements: ' + els().length;
  document.getElementById('countStatus').textContent = 'Elements: ' + els().length;
  document.getElementById('whStatus').textContent = 'W:' + canvas.offsetWidth + ' H:' + canvas.offsetHeight;
  // Add current page name to status
  const pageNameEl = document.getElementById('currentPageStatus');
  if (pageNameEl) pageNameEl.textContent = '📄 ' + (page().name || 'Untitled');
}
```

Add a span to the status bar HTML:
```html
<div class="status-mid">
  <span id="currentPageStatus">📄 Home</span>   <!-- ← new -->
  <span id="countStatus">Elements: 0</span>
  <span id="xyStatus">X:0 Y:0</span>
  <span id="whStatus">W:1200 H:800</span>
</div>
```

---

### 4.3 Debounce Number Input Re-renders

**Problem:** Typing "1200" in an X/Y/W/H field fires 4 `render()` calls in rapid succession.

**Fix — switch position/size inputs from `input` to `change` events:**

```javascript
// In the Object.entries(map).forEach block, change the event binding:
const numberKeys = ['x', 'y', 'w', 'h', 'font', 'radius', 'opacity'];
const liveKeys   = ['text', 'fill', 'color', 'weight', 'action', 'target'];  // keep live

Object.entries(map).forEach(([id, k]) => {
  const inputEl = document.getElementById(id);
  const eventType = numberKeys.includes(k) ? 'change' : 'input';
  inputEl.addEventListener(eventType, e => {
    const el = selected()[0];
    if (!el || state.selected.length !== 1) return;
    let v = e.target.value;
    if (numberKeys.includes(k)) v = Number(v);
    el[k] = v;
    render();
  });
  inputEl.addEventListener('change', saveHist);
});
```

---

### 4.4 Add Color Swatches to Theme Cards

```javascript
// Replace the theme-grid HTML generation (or update it directly in HTML):
const themeSwatchMap = {
  forge:    ['#ff9800', '#20d8ff', '#ffffff', '#111827'],
  slate:    ['#38bdf8', '#1e293b', '#0f172a', '#f8fafc'],
  light:    ['#2563eb', '#ffffff', '#f8fafc', '#0f172a'],
  terminal: ['#22c55e', '#052e16', '#020617', '#dcfce7']
};

// After rendering theme cards, add swatches:
document.querySelectorAll('[data-theme]').forEach(card => {
  const theme = card.dataset.theme;
  const swatches = themeSwatchMap[theme] || [];
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-top:8px';
  swatches.forEach(color => {
    const s = document.createElement('div');
    s.style.cssText = `width:16px;height:16px;border-radius:4px;background:${color};border:1px solid rgba(255,255,255,0.15)`;
    row.appendChild(s);
  });
  card.appendChild(row);
});
```

---

### 4.5 Fix `document.execCommand` Deprecation in Inline Editor

**Location:** `inlineEditElement()`, line 520

```javascript
// Replace:
document.execCommand('selectAll', false, null);

// With:
setTimeout(() => {
  const range = document.createRange();
  range.selectNodeContents(ed);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}, 0);
```

---

### 4.6 Add Firefox Scrollbar Styling

```css
/* Add to the existing scrollbar rules */
.side-panel,
.inspector-body {
  scrollbar-width: thin;
  scrollbar-color: #3f5268 #090e15;
}
```

---

### 4.7 Update the Roadmap Panel

```html
<!-- In the roadmap-list div, update the ZIP export entry: -->
<div>✓ ZIP export</div>   <!-- was: ◯ ZIP export -->
```

---

## Phase 5 — Dead Code & Cleanup

Low-effort, improves maintainability, should be done in one pass.

---

### 5.1 Delete Unused Export Functions

Remove entirely — they are never called and are superseded:

- `exportZipHtmlFiles()` (line 448–458)
- `exportZipLikeBundle()` (line 723–730)
- `makeFullExportHtml()` (line 732–734)
- `exportBundle()` (line 539–547)

---

### 5.2 Rename and Consolidate the Export Pipeline

```javascript
// Rename betterExportHtml → exportHtml
// Remove the one-liner wrapper:
// function exportHtml(){ return betterExportHtml() }   ← DELETE THIS
```

Update the 4 call sites that reference `exportHtml()` to call the renamed function directly.

---

### 5.3 Remove Unused `.theme-swatch` CSS Class

Lines 72–73 define `.theme-swatch` but no element uses it. After implementing Phase 4.4
(which adds inline color dots instead), delete:

```css
/* DELETE: */
.theme-swatch{height:34px;border-radius:8px;border:1px solid var(--line2);cursor:pointer}
.theme-swatch:hover{outline:2px solid var(--cyan);outline-offset:2px}
```

---

### 5.4 Add Missing `migrateProject` Fields for New Properties

Every new field added in Phases 3 and 4 must be back-filled in `migrateProject()` so that
old saved projects load without errors:

```javascript
function migrateProject() {
  state.pages.forEach(pg => {
    pg.width      = Number(pg.width  || 1200);
    pg.height     = Number(pg.height || 800);
    pg.background = pg.background || '#ffffff';
    pg.elements   = pg.elements   || [];
    pg.elements.forEach(el => {
      el.name        = el.name      || `${el.type || 'element'} ${el.id}`;
      el.children    = el.children  || [];
      el.parent      = el.parent    || null;
      el.opacity     = Number(el.opacity  ?? 100);
      el.radius      = Number(el.radius   ?? 0);
      el.font        = Number(el.font     ?? 14);
      el.weight      = String(el.weight   ?? '600');
      el.locked      = !!el.locked;
      el.hidden      = !!el.hidden;
      el.action      = el.action || '';
      el.target      = el.target || '';
      // Phase 3 additions:
      el.rotation    = Number(el.rotation   ?? 0);
      el.shadow      = el.shadow            ?? '';
      el.fontFamily  = el.fontFamily        ?? 'Inter, Segoe UI, sans-serif';
      el.borderStyle = el.borderStyle       ?? 'solid';
    });
  });
  // Migrate guides
  if (!state.guides) state.guides = { x: [], y: [] };
}
```

---

## Testing Checklist

Use this checklist to verify each phase before merging.

### Phase 1 — Critical Bugs
- [ ] Inspector Style tab shows only Position, Text, Style sections
- [ ] Inspector Settings tab shows only Canvas, Options sections
- [ ] Inspector Actions tab shows only Behavior section
- [ ] Moving an element with arrow keys then pressing Ctrl+Z restores its original position
- [ ] Reloading after arrow-key moves preserves those positions
- [ ] Clicking the hand tool button changes the cursor to `grab`
- [ ] Hand tool allows panning the workspace by dragging
- [ ] Exported HTML contains no `var(--line)` or `var(--muted)` references
- [ ] Exported HTML page navigation works correctly in a browser
- [ ] Layer panel rows display all 5 cells in a single horizontal line
- [ ] Layer reorder up/down buttons correctly change element Z-order

### Phase 2 — Significant Bugs
- [ ] Changing device in toolbar immediately updates the inspector canvas size select
- [ ] Changing canvas size in inspector immediately updates the toolbar device select
- [ ] Selected element icon shows the correct symbol per element type
- [ ] Uploading a 2 MB image shows a rejection toast; no upload occurs
- [ ] Uploading a 500 KB image succeeds; assets panel shows the image
- [ ] After uploading an image and performing 50+ actions, browser DevTools memory is not >200 MB
- [ ] Right-clicking near the bottom-right corner shows the full context menu on screen

### Phase 3 — Missing Core Features
- [ ] Rotation: setting 45° in the inspector rotates the element visually
- [ ] Rotation: save, reload, element is still rotated correctly
- [ ] Shift-resize: dragging the SE corner while holding Shift maintains aspect ratio
- [ ] Distribute H: 4 cards evenly spaced after clicking Distribute Horizontally
- [ ] Distribute V: works correctly for vertically stacked elements
- [ ] Font family: selecting "Georgia" changes the element font to serif
- [ ] Box shadow: "Medium" shadow preset adds a visible drop shadow
- [ ] Shadow is present in the exported prototype HTML
- [ ] Ruler click: clicking top ruler drops a vertical guide line
- [ ] Guide persistence: guide lines survive save/reload
- [ ] Guide removal: double-clicking a guide deletes it
- [ ] Clipboard persistence: copy, reload, Ctrl+V pastes the copied elements
- [ ] Ctrl+P toggles preview mode
- [ ] Escape deselects all elements
- [ ] Escape exits preview mode
- [ ] Border style "Dashed" renders a dashed border on the canvas element

### Phase 4 — UX & UI
- [ ] Status bar shows current page name at all times
- [ ] Page name updates when switching pages
- [ ] Typing "1200" in the X field does not cause 4 canvas re-renders
- [ ] Theme cards show color swatches
- [ ] Inline text editor correctly pre-selects text on double-click in all modern browsers
- [ ] Side panels show a styled scrollbar in Firefox
- [ ] Roadmap panel shows ZIP export as ✓ completed

### Phase 5 — Dead Code
- [ ] `exportZipHtmlFiles` is not defined anywhere in the file
- [ ] `exportZipLikeBundle` is not defined anywhere in the file
- [ ] `makeFullExportHtml` is not defined anywhere in the file
- [ ] `exportBundle` is not defined anywhere in the file
- [ ] `betterExportHtml` is renamed to `exportHtml`; the one-liner wrapper is deleted
- [ ] `.theme-swatch` CSS rule does not exist in the stylesheet
- [ ] `migrateProject()` sets default values for all new Phase 3 fields

---

## Implementation Order Summary

| Phase | Est. effort | Dependency |
|-------|-------------|------------|
| 1.2 Arrow key history | 15 min | None |
| 1.5 Layer panel grid | 20 min | None |
| 2.5 Context menu bounds | 15 min | None |
| 1.4 Export HTML cleanup | 30 min | None |
| 5.x Dead code removal | 30 min | None |
| 2.1 Device sync | 20 min | None |
| 2.2 Selected icon | 20 min | None |
| 4.x UX improvements | 2 hrs | None |
| 1.1 Inspector tabs | 1 hr | Phase 4.1 (section IDs) |
| 1.3 Bottom toolbar | 1–2 hrs | None |
| 2.3 Asset history fix | 1 hr | None |
| 2.4 Asset size limit | 20 min | 2.3 |
| 3.9 Escape key | 15 min | None |
| 3.8 Ctrl+P preview | 10 min | None |
| 3.7 Clipboard persist | 20 min | None |
| 3.1 Rotation | 2 hrs | 5.4 (migration) |
| 3.2 Aspect ratio lock | 1 hr | None |
| 3.3 Distribute | 1 hr | None |
| 3.4 Font family | 1 hr | 5.4 (migration) |
| 3.5 Box shadow | 45 min | 5.4 (migration) |
| 3.10 Border style | 45 min | 5.4 (migration) |
| 3.6 Persistent guides | 2 hrs | 5.4 (migration) |

**Total estimated effort: ~18–22 hours of focused development**

---

*Document generated from analysis of FORGE V15 Local Beta (Forge.html, 933 lines).*
*All line references are approximate and may shift as fixes are applied.*
