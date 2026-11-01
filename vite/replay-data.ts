/// <reference types="node" />
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Plugin } from "vite";

/** The only file under public/replay that is part of the repository (hand-written, no real speech). */
export const SAMPLE_REPLAY = "sample.json";

const FORBIDDEN_EXTENSION = /\.(wav|mp3|m4a|flac|ogg|tsv|docx|onnx|ckpt)$/i;
const FORBIDDEN_NAME = /^(truth|roster|vahetused|scd|voiceprint|enrolment|hindamisraport)/i;
const REPLAY_NAME = /^[A-Za-z0-9_-]+$/;

/** Where replays of real recordings live: outside the repository (same default as tools/make-replay.py). */
export function dataDir(): string {
  return process.env["KONEVALI_DATA_DIR"] || path.join(os.homedir(), "konevali-data");
}

/**
 * Files under the public folder that a build must never publish: anything in replay/ except the sample,
 * recordings, tables and models, and names that mean truth tables, rosters or analysis output.
 * Returns paths relative to `publicDir`, sorted.
 */
export function findForbiddenPublicFiles(publicDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const relative = path.relative(publicDir, full).split(path.sep).join("/");
      const strayReplay = relative.startsWith("replay/") && relative !== `replay/${SAMPLE_REPLAY}`;
      if (strayReplay || FORBIDDEN_EXTENSION.test(entry.name) || FORBIDDEN_NAME.test(entry.name)) found.push(relative);
    }
  };
  if (fs.existsSync(publicDir)) walk(publicDir);
  return found.sort();
}

/**
 * Development only: serves /replay/<name>.json from <data folder>/replay, so `?replay=<name>` works for real
 * recordings that are kept outside the repository. Anything else (other extensions, names of truth tables,
 * rosters or analysis files, a missing file) falls through to the normal public folder.
 */
export function replayDevServer(dir: string = dataDir()): Plugin {
  return {
    name: "konevali-replay-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = /^\/replay\/([^/?#]+)\.json(?:\?.*)?$/.exec(request.url ?? "")?.[1];
        if (!name || !REPLAY_NAME.test(name) || FORBIDDEN_NAME.test(name)) return next();
        const file = path.join(dir, "replay", `${name}.json`);
        if (!fs.existsSync(file)) return next();
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        fs.createReadStream(file).pipe(response);
      });
    },
  };
}

/**
 * Build only: fails if the public folder holds anything that would be published but must not be, and removes
 * stale copies of public/replay left in the output by earlier builds (the output is regenerated from public).
 */
export function publicDataGuard(): Plugin {
  let root = process.cwd();
  let publicDir = path.join(root, "public");
  return {
    name: "konevali-public-data-guard",
    apply: "build",
    configResolved(config) {
      root = config.root;
      if (typeof config.publicDir === "string" && config.publicDir) publicDir = config.publicDir;
    },
    buildStart() {
      const forbidden = findForbiddenPublicFiles(publicDir);
      if (forbidden.length) {
        this.error(
          `public/ contains files that must not be published:\n  ${forbidden.join("\n  ")}\n` +
            `Keep real recordings, replays, truth tables and rosters outside the repository (see README, "Real recordings").`,
        );
      }
      // buildStart runs once per environment, so only stale files are removed: the sample may already be copied
      const stale = path.join(root, ".output", "public", "replay");
      if (fs.existsSync(stale)) {
        for (const entry of fs.readdirSync(stale)) {
          if (entry !== SAMPLE_REPLAY) fs.rmSync(path.join(stale, entry), { recursive: true, force: true });
        }
      }
    },
  };
}
