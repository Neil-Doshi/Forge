import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const maxTotal = 5 * 1024 * 1024;
const shellReview = 500 * 1024;
const editorReview = 1.25 * 1024 * 1024;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

export async function measureDirectory(root = dist) {
  const files = await walk(root);
  const rows = [];
  for (const file of files) {
    const info = await stat(file);
    const chunks = [];
    await new Promise((resolve, reject) => {
      createReadStream(file)
        .on("data", (chunk) => chunks.push(chunk))
        .on("error", reject)
        .on("end", resolve);
    });
    const gz = gzipSync(Buffer.concat(chunks)).length;
    rows.push({ file: relative(root, file).replace(/\\/g, "/"), bytes: info.size, gzipBytes: gz });
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const rows = await measureDirectory();
    const total = rows.reduce((sum, row) => sum + row.bytes, 0);
    const totalGzip = rows.reduce((sum, row) => sum + row.gzipBytes, 0);
    const editor = rows.filter((row) => row.file.includes("editor-grapesjs"));
    const shell = rows.filter((row) => row.file.endsWith(".js") && !row.file.includes("editor-grapesjs"));
    const shellGzip = shell.reduce((sum, row) => sum + row.gzipBytes, 0);
    const editorGzip = editor.reduce((sum, row) => sum + row.gzipBytes, 0);

    console.table(rows);
    console.log(`Total assets: ${total} bytes (${totalGzip} gzip bytes)`);
    console.log(`Non-editor JS gzip: ${shellGzip} bytes`);
    console.log(`Editor chunk gzip: ${editorGzip} bytes`);

    if (total > maxTotal) throw new Error("Published application assets exceed 5 MB target.");
    if (shellGzip > shellReview) throw new Error("Home/editor-excluded shell exceeds 500 KB gzip review threshold.");
    if (editorGzip > editorReview) throw new Error("Editor chunk exceeds 1.25 MB gzip review threshold.");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
