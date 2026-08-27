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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

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
    const here = dirname(file);
    /*
     * `@/lib/atlas/<name>` resolves to one of two different files, and which
     * one is not something a hand-written list can be trusted to remember.
     *
     * tsc compiles the .ts modules in tsconfig.adapters.json's `include` into
     * the build; the plain-CommonJS ones — dates.js, wildlife-terms.js — are
     * not in it and never appear there, so an import of those has to point at
     * the real file in the repo. Node's ESM loader reads their named exports
     * through cjs-module-lexer, which handles the static `module.exports`
     * object each of them ends with.
     *
     * Asking the filesystem which case applies is the version that cannot go
     * stale, and computing the path per FILE rather than assuming `../` is
     * what makes it correct for modules compiled to the build root as well as
     * for the ones under adapters/.
     */
    const rel = (target) => {
      const p = relative(here, target).replace(/\\/g, "/");
      return p.startsWith(".") ? p : `./${p}`;
    };
    writeFileSync(
      file,
      readFileSync(file, "utf8")
        .replace(/from "@\/lib\/atlas\/([a-zA-Z0-9-]+)"/g, (_m, name) => {
          const built = join(BUILD, `${name}.js`);
          const target = existsSync(built) ? built : join(root, "lib", "atlas", `${name}.js`);
          return `from "${rel(target)}"`;
        })
        // Node's ESM loader will not guess the extension on a relative import.
        .replace(/from "(\.\/[a-zA-Z-]+)"/g, 'from "$1.js"'),
    );
  }
  return BUILD;
}
