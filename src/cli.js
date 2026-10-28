// The command line: `doalu-mcp where-to-stay "bergen"`, `find`, `areas`; no command serves MCP on stdio.

import { Guide, VERSION } from "./guide.js";
import { callTool, serve } from "./server.js";

export const USAGE = `doalu-mcp ${VERSION}: where to stay, from the doalu.com guide

  doalu-mcp where-to-stay <place>   the areas to stay in and who each suits, with links
  doalu-mcp areas <place>           the stay areas and the places within a place
  doalu-mcp find <name>             places with a doalu.com page matching a name
  doalu-mcp [serve]                 run as an MCP server on stdio (what MCP clients start)

  <place> is a name ("bergen", "Springfield, Illinois") or a doalu.com page URL.
  Options: --json (the structured answer), --base URL (default https://doalu.com, or $DOALU_BASE).`;

const COMMANDS = { "where-to-stay": "where_to_stay", areas: "list_areas", "list-areas": "list_areas", find: "find_place" };

/** Runs the CLI; returns the exit code. `out`/`err` take a string. */
export async function main(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s), guide } = {}) {
  const args = [];
  let json = false;
  let base = process.env.DOALU_BASE;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--base") base = argv[++i];
    else if (a.startsWith("--base=")) base = a.slice(7);
    else if (a === "-h" || a === "--help") {
      out(`${USAGE}\n`);
      return 0;
    } else if (a === "-v" || a === "--version") {
      out(`${VERSION}\n`);
      return 0;
    } else args.push(a);
  }
  guide ??= new Guide({ base });
  const [cmd, ...rest] = args;
  if (cmd === undefined || cmd === "serve" || cmd === "mcp") {
    await serve(guide);
    return 0;
  }
  const tool = COMMANDS[cmd];
  const value = rest.join(" ").trim();
  if (!tool || !value) {
    err(`${USAGE}\n`);
    return 2;
  }
  const res = await callTool(guide, tool, tool === "find_place" ? { query: value } : { place: value });
  if (res.isError) {
    err(`${res.content[0].text}\n`);
    return 1;
  }
  out(json ? `${JSON.stringify(res.structuredContent, null, 2)}\n` : `${res.content[0].text}\n`);
  const empty = res.structuredContent.results?.length === 0;
  return empty ? 1 : 0;
}
