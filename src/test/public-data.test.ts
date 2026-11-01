import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findForbiddenPublicFiles, replayDevServer } from "../../vite/replay-data";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "konevali-test-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function touch(relative: string, content = "x") {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe("public/ holds nothing that must not be published", () => {
  // The repository's own public folder: this is what a build copies into the deployed site.
  it("has no replays of real recordings, audio, truth tables or rosters", () => {
    expect(findForbiddenPublicFiles(path.resolve(process.cwd(), "public"))).toEqual([]);
  });

  it("only allows public/replay/sample.json in replay/", () => {
    touch("replay/sample.json");
    touch("favicon.ico");
    touch("replay/meeting.json");
    expect(findForbiddenPublicFiles(dir)).toEqual(["replay/meeting.json"]);
  });

  it("finds audio, tables, models and truth, roster and analysis names anywhere", () => {
    for (const name of ["a.wav", "b.mp3", "c.m4a", "t.tsv", "d.docx", "m.onnx", "m.ckpt", "truth-rec1.json", "roster.json", "scd-rec1.json", "voiceprints.json", "x/hindamisraport.md"]) {
      touch(name);
    }
    touch("robots.txt");
    expect(findForbiddenPublicFiles(dir)).toHaveLength(12);
  });

  it("copes with a missing folder", () => {
    expect(findForbiddenPublicFiles(path.join(dir, "nope"))).toEqual([]);
  });
});

describe("replayDevServer", () => {
  function run(url: string) {
    touch("replay/meeting.json", '{"events":[]}');
    touch("replay/truth-rec1.json", "secret");
    touch("replay/scd-rec1.json", "secret");
    let handler: (request: { url?: string }, response: unknown, next: () => void) => void = () => {};
    const plugin = replayDevServer(dir);
    (plugin.configureServer as (server: unknown) => void)({ middlewares: { use: (h: typeof handler) => (handler = h) } });
    const next = vi.fn();
    const response = Object.assign(new PassThrough(), { setHeader: vi.fn() });
    handler({ url }, response, next);
    return { next, response };
  }

  it("serves an existing replay from the data folder", async () => {
    const { next, response } = run("/replay/meeting.json");
    expect(next).not.toHaveBeenCalled();
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('{"events":[]}');
  });

  it("lets everything else fall through to the normal public folder", () => {
    for (const url of ["/replay/missing.json", "/replay/truth-rec1.json", "/replay/scd-rec1.json", "/replay/meeting.tsv", "/replay/..%2Fsecret.json", "/replay/a/b.json", "/other/meeting.json"]) {
      expect(run(url).next).toHaveBeenCalled();
    }
  });
});
