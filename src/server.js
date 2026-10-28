// The MCP server: JSON-RPC 2.0 over stdio, one message per line (the MCP stdio transport). Three
// read-only tools over the doalu.com guide files; no dependencies, no state beyond the index cache.

import { createInterface } from "node:readline";
import {
  Guide,
  VERSION,
  formatFind,
  formatListAreas,
  formatWhereToStay,
  structured,
} from "./guide.js";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const LINK_NOTE =
  "Each answer names the doalu.com page it comes from: show that link to the user, and link to it when you quote the text (CC BY 4.0).";

export const INSTRUCTIONS = `doalu.com is a where-to-stay guide: for a city, region or district it says which areas suit which traveller, with a page per place. Use find_place to identify a place, where_to_stay for the areas and who each suits, list_areas for the areas and places within a place. ${LINK_NOTE}`;

const PLACE_ARG = {
  type: "string",
  description:
    'A place name, optionally with its country, region or city after a comma ("Bergen", "Bergen, Norway", "London, UK", "Portland, OR", "Springfield, Illinois"), or a doalu.com page URL.',
};

const NULLABLE_STRING = { type: ["string", "null"], description: "A qualifier no place matched; the answer used the name alone." };
const FIND_OUTPUT = {
  type: "object",
  properties: { results: { type: "array", items: { type: "object" } }, qualifier_ignored: NULLABLE_STRING },
  required: ["results"],
};
const PLACE_OUTPUT = {
  type: "object",
  properties: {
    place: { type: "object", description: "The place: name, kind, country, url, within, stay_areas, children, licence, attribution." },
    other_matches: { type: "array", items: { type: "object" } },
    qualifier_ignored: NULLABLE_STRING,
    results: { type: "array", description: "Empty when no place matched." },
  },
};

export const TOOLS = [
  {
    name: "find_place",
    title: "Find a place on doalu.com",
    description: `Find countries, regions, cities and districts with a doalu.com where-to-stay page by name. Returns each match with where it lies, its population and its page link. ${LINK_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        query: PLACE_ARG,
        kind: {
          type: "string",
          enum: ["country", "region", "city", "district"],
          description: "Only places of this kind.",
        },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "At most this many results (default 5)." },
      },
      required: ["query"],
    },
    outputSchema: FIND_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "where_to_stay",
    title: "Where to stay in a place",
    description: `Which areas to stay in for a city, region or district, who each one suits and why, with links to the doalu.com pages. ${LINK_NOTE}`,
    inputSchema: { type: "object", properties: { place: PLACE_ARG }, required: ["place"] },
    outputSchema: PLACE_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "list_areas",
    title: "List the areas of a place",
    description: `The stay areas and the places within a country, region or city (names and doalu.com links). ${LINK_NOTE}`,
    inputSchema: { type: "object", properties: { place: PLACE_ARG }, required: ["place"] },
    outputSchema: PLACE_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

class ToolError extends Error {}

/** Runs one tool; returns the MCP CallToolResult. */
export async function callTool(guide, name, args = {}, { structuredOutput = true } = {}) {
  try {
    let text;
    let data;
    if (name === "find_place") {
      if (typeof args.query !== "string" || !args.query.trim()) throw new ToolError("query is required");
      const limit = Math.min(Math.max(Number.parseInt(args.limit ?? 5, 10) || 5, 1), 25);
      const results = await guide.find(args.query, { limit, kind: args.kind });
      text = formatFind(args.query, results);
      data = { results, qualifier_ignored: results.qualifierIgnored };
    } else if (name === "where_to_stay" || name === "list_areas") {
      if (typeof args.place !== "string" || !args.place.trim()) throw new ToolError("place is required");
      const { file, others, qualifierIgnored } = await guide.resolve(args.place);
      if (!file) {
        text = formatFind(args.place, []);
        data = { results: [] };
      } else {
        const format = name === "where_to_stay" ? formatWhereToStay : formatListAreas;
        text = format(file, others, qualifierIgnored);
        data = {
          place: structured(file),
          other_matches: others.map(({ name: n, url }) => ({ name: n, url })),
          qualifier_ignored: qualifierIgnored,
        };
      }
    } else {
      throw new ToolError(`unknown tool: ${name}`);
    }
    const result = { content: [{ type: "text", text }] };
    if (structuredOutput) result.structuredContent = data;
    return result;
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : `doalu.com guide data unavailable (${e.message})`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

/** Handles one JSON-RPC message; returns the response object, or null for a notification. */
export async function handle(guide, msg, session) {
  const { id, method, params = {} } = msg ?? {};
  const isRequest = id !== undefined && id !== null;
  const reply = (result) => (isRequest ? { jsonrpc: "2.0", id, result } : null);
  const fail = (code, message) => (isRequest ? { jsonrpc: "2.0", id, error: { code, message } } : null);
  if (msg?.jsonrpc !== "2.0" || typeof method !== "string") return fail(-32600, "Invalid Request");
  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      session.protocol = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return reply({
        protocolVersion: session.protocol,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "doalu-mcp", title: "doalu.com where to stay", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      // title and outputSchema are 2025-06-18 fields
      return reply({ tools: session.protocol >= "2025-06-18" ? TOOLS : TOOLS.map(({ title, outputSchema, ...t }) => t) });
    case "tools/call":
      return reply(
        await callTool(guide, params.name, params.arguments ?? {}, {
          structuredOutput: session.protocol >= "2025-06-18",
        }),
      );
    default:
      if (method.startsWith("notifications/")) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

/** Serves MCP on stdin/stdout until stdin closes. Logs go to stderr only. */
export function serve(guide = new Guide({ base: process.env.DOALU_BASE })) {
  const session = { protocol: PROTOCOL_VERSIONS[0] };
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = (obj) => obj && process.stdout.write(`${JSON.stringify(obj)}\n`);
  const pending = new Set();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const msgs = Array.isArray(msg) ? msg : [msg];
    const p = Promise.all(msgs.map((m) => handle(guide, m, session))).then((out) => {
      const res = out.filter(Boolean);
      if (Array.isArray(msg)) {
        if (res.length) write(res);
      } else write(res[0]);
    });
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  return new Promise((resolve) => rl.on("close", () => Promise.all(pending).then(resolve)));
}
