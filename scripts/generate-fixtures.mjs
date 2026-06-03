import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const rows = Array.from({ length: 3000 }, (_, index) => {
  const id = String(index + 1).padStart(4, "0");
  return `<li class="stress-row" data-target="detail-${id}"><button onclick="switchView('detail-${id}')">Open ${id}</button><span>Meaningful node ${id}</span></li>`;
}).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>HTML Forge Large Synthetic Fixture</title>
<style>
:root { --stress-accent: #0f766e; }
.stress-row { display: grid; grid-template-columns: auto 1fr; gap: 8px; padding: 4px; }
@keyframes stressFade { from { opacity: 0; } to { opacity: 1; } }
</style>
</head>
<body>
<section id="stress-view" data-view="stress"><h1>Stress Fixture</h1><ul>${rows}</ul></section>
<script>function switchView(name){ console.log(name); }</script>
</body>
</html>
`;

await writeFile(join("fixtures", "large-project.html"), html, "utf8");
console.log("Generated fixtures/large-project.html with 3000 rows.");
