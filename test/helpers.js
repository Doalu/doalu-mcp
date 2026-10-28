import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Guide } from "../src/guide.js";

export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

/** A fetch over the fixture files (real guide files from a doalu.com build), counting calls. */
export function fixtureFetch() {
  const f = async (url) => {
    f.calls.push(url);
    const path = new URL(url).pathname;
    try {
      const body = await readFile(FIXTURES + path, "utf8");
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
  f.calls = [];
  return f;
}

export const guide = () => new Guide({ base: "https://doalu.test", fetch: fixtureFetch() });

/** The fixtures over HTTP on a free local port (for the CLI and the stdio server). */
export async function fixtureServer() {
  const server = createServer(async (req, res) => {
    try {
      const body = await readFile(FIXTURES + new URL(req.url, "http://x").pathname);
      res.writeHead(200, { "content-type": "application/json" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
