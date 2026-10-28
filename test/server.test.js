import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { callTool, handle, INSTRUCTIONS, TOOLS } from "../src/server.js";
import { fixtureServer, guide } from "./helpers.js";

const BIN = fileURLToPath(new URL("../bin/doalu-mcp.js", import.meta.url));
// Anything that would expose what the guide never publishes: coordinates, images, partner or price links.
const LEAK = /-?\d{1,3}\.\d{4,}|img\.doalu\.com|\/out\/|booking\.com|latitude|longitude|\.(jpe?g|png|webp|avif)\b/i;

test("the three tools, read-only, each asking clients to show the doalu.com link", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ["find_place", "where_to_stay", "list_areas"]);
  for (const t of TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.match(t.description, /show that link to the user/);
    assert.equal(t.inputSchema.type, "object");
  }
  assert.match(INSTRUCTIONS, /show that link to the user/);
  assert.doesNotMatch(JSON.stringify(TOOLS) + INSTRUCTIONS, /\bAI\b|artificial intelligence|generated/i);
});

test("initialize negotiates the version; tools/list; unknown method; notification gets no reply", async () => {
  const g = guide();
  const s = {};
  const init = await handle(g, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, s);
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.equal(init.result.serverInfo.name, "doalu-mcp");
  const list = await handle(g, { jsonrpc: "2.0", id: 2, method: "tools/list" }, s);
  assert.equal(list.result.tools.length, 3);
  assert.equal(list.result.tools[0].title, undefined); // title and outputSchema are 2025-06-18 fields
  assert.equal(list.result.tools[0].outputSchema, undefined);
  const s2 = {};
  const init2 = await handle(g, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }, s2);
  assert.equal(init2.result.protocolVersion, "2025-06-18");
  const list2 = await handle(g, { jsonrpc: "2.0", id: 2, method: "tools/list" }, s2);
  // structuredContent is declared (review r1): every tool has an outputSchema of type object
  for (const t of list2.result.tools) assert.equal(t.outputSchema.type, "object", t.name);
  assert.equal((await handle(g, { jsonrpc: "2.0", id: 3, method: "nope" }, s)).error.code, -32601);
  assert.equal(await handle(g, { jsonrpc: "2.0", method: "notifications/initialized" }, s), null);
  assert.deepEqual((await handle(g, { jsonrpc: "2.0", id: 4, method: "ping" }, s)).result, {});
  assert.equal((await handle(g, { id: 5, method: "ping" }, s)).error.code, -32600);
});

test("every tool answer carries the doalu.com page link, the credit, and nothing unpublished", async () => {
  const g = guide();
  for (const [name, args, link] of [
    ["find_place", { query: "Springfield" }, "https://doalu.com/us/missouri/springfield/"],
    ["where_to_stay", { place: "Bergen" }, "https://doalu.com/no/vestland/bergen/"],
    ["list_areas", { place: "malmo" }, "https://doalu.com/se/skane-county/malmo/"],
  ]) {
    const r = await callTool(g, name, args);
    assert.equal(r.isError, undefined, name);
    assert.ok(r.content[0].text.includes(link), name);
    assert.match(r.content[0].text, /CC BY 4\.0/);
    assert.doesNotMatch(r.content[0].text + JSON.stringify(r.structuredContent), LEAK, name);
  }
  const w = await callTool(g, "where_to_stay", { place: "Bergen" });
  assert.equal(w.structuredContent.place.url, "https://doalu.com/no/vestland/bergen/");
  assert.equal(w.structuredContent.place.licence, "CC BY 4.0");
  assert.equal(w.structuredContent.place.stay_areas.length, 3);
});

test("tool errors are results with isError, not protocol errors", async () => {
  const g = guide();
  assert.equal((await callTool(g, "where_to_stay", {})).isError, true);
  assert.equal((await callTool(g, "nope", {})).isError, true);
  const down = await callTool({ find: async () => { throw new Error("HTTP 503"); } }, "find_place", { query: "x" });
  assert.equal(down.isError, true);
  assert.match(down.content[0].text, /unavailable \(HTTP 503\)/);
  const none = await callTool(g, "where_to_stay", { place: "nowhere at all" });
  assert.equal(none.isError, undefined);
  assert.match(none.content[0].text, /No place on doalu\.com matches/);
});

function run(args, { input, env } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
    p.stdin.end(input ?? "");
  });
}

test("CLI: where-to-stay, find --json, usage, no match", async () => {
  const srv = await fixtureServer();
  try {
    const w = await run(["where-to-stay", "bergen", "--base", srv.base]);
    assert.equal(w.code, 0, w.err);
    assert.match(w.out, /^Where to stay in Bergen \(Vestland, Norway\): https:\/\/doalu\.com\/no\/vestland\/bergen\//);
    const f = await run(["find", "Springfield,", "Illinois", "--json"], { env: { DOALU_BASE: srv.base } });
    assert.equal(f.code, 0, f.err);
    assert.deepEqual(JSON.parse(f.out).results.map((r) => r.url), ["https://doalu.com/us/illinois/springfield/"]);
    assert.equal((await run(["where-to-stay"])).code, 2);
    assert.equal((await run(["find", "zzz", "--base", srv.base])).code, 1);
    assert.match((await run(["--help"])).out, /doalu-mcp where-to-stay <place>/);
  } finally {
    srv.close();
  }
});

test("stdio server: a client session over newline-delimited JSON-RPC", async () => {
  const srv = await fixtureServer();
  try {
    const msgs = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "where_to_stay", arguments: { place: "Bergen, Norway" } } },
    ];
    const input = `${msgs.map((m) => JSON.stringify(m)).join("\n")}\nnot json\n`;
    const r = await run([], { input, env: { DOALU_BASE: srv.base } });
    assert.equal(r.code, 0, r.err);
    const replies = r.out.trim().split("\n").map((l) => JSON.parse(l));
    const byId = Object.fromEntries(replies.map((m) => [m.id, m]));
    assert.equal(replies.length, 4); // no reply to the notification; a parse error for the bad line
    assert.equal(byId[1].result.protocolVersion, "2025-06-18");
    assert.equal(byId[2].result.tools.length, 3);
    assert.match(byId[3].result.content[0].text, /https:\/\/doalu\.com\/no\/vestland\/bergen\//);
    assert.equal(byId[3].result.structuredContent.place.country, "NO");
    assert.equal(byId.null.error.code, -32700);
  } finally {
    srv.close();
  }
});

test("a qualifier no place matches is said in the answer, not hidden (review r1)", async () => {
  const r = await callTool(guide(), "where_to_stay", { place: "Bergen, Peru" });
  assert.match(r.content[0].text, /^No match in "Peru" on doalu\.com; the closest place with that name:\n\nWhere to stay in Bergen/);
  assert.equal(r.structuredContent.qualifier_ignored, "Peru");
  const f = await callTool(guide(), "find_place", { query: "Bergen, Peru" });
  assert.match(f.content[0].text, /^No place on doalu\.com matches "Bergen, Peru" in "Peru"\. Places with that name:/);
});
