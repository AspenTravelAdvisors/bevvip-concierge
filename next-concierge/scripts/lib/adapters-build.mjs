/**
 * Compile the REAL adapters to plain ESM that Node can import.
 *
 * Four verifiers — adapters, deeplinks, hotels, and anything added next — want
 * to run the shipped filter code rather than a transcription of it, and all of
 * them need the same two fixes applied to tsc's output: the `@/` alias, which
 * tsc leaves in place, and the extensionless relative imports, which Node's ESM
 * loader rejects.
 *
 * ── Why this is a module and not a paragraph repeated three times ──────────
 *
 * It WAS repeated three times, each copy carrying a comment telling the reader
 * to keep it in step with the other two. Adding one shared module under
 * lib/atlas — the wildlife vocabulary — broke two of the three, because each
 * copy listed the importable modules by hand and `geo` was the only name on the
 * list. The failure is a bare `ERR_MODULE_NOT_FOUND` naming a package called
 * "@/lib", which tells the reader nothing about what actually happened.
 *
 * The rule that replaces the hand-kept list is the one that was always true:
 * tsconfig.adapters.json sets `rootDir` to lib/atlas, so every module it
 * compiles lands exactly one directory above adapters/. Nothing needs listing.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : [],
  );

/**
 * @param {string} root  repo root (the directory holding tsconfig.adapters.json)
 * @returns {string} the build directory, ready to import from
 */
export function buildAdapters(root) {
  const BUILD = join(root, ".adapters-build");
  rmSync(BUILD, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", "tsconfig.adapters.json"], { cwd: root, stdio: "inherit" });
  for (const file of walk(BUILD)) {
    writeFileSync(
      file,
      readFileSync(file, "utf8")
        /*
         * dates.js is CommonJS and lives outside rootDir, so tsc never copies
         * it into the build — point at the real file instead. Node's ESM loader
         * reads its named exports through cjs-module-lexer, which handles the
         * static `module.exports = { … }` object it ends with.
         *
         * This has to run BEFORE the general rule below, which would otherwise
         * claim it and point at a file that is not there.
         */
        .replace(/from "@\/lib\/atlas\/dates"/g, 'from "../../lib/atlas/dates.js"')
        // Everything else under lib/atlas/ that tsc DID compile — geo,
        // route-frame, wildlife, and whatever an adapter reaches for next.
        .replace(/from "@\/lib\/atlas\/([a-zA-Z0-9-]+)"/g, 'from "../$1.js"')
        // Node's ESM loader will not guess the extension on a relative import.
        .replace(/from "(\.\/[a-zA-Z-]+)"/g, 'from "$1.js"'),
    );
  }
  return BUILD;
}
