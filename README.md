<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/doalu-lockup-reversed.svg">
    <img src="assets/doalu-lockup-color.svg" alt="Doalu" height="40">
  </picture>
  <br>
</p>

# doalu-mcp

**Where to stay, by area.** Pick the right area first. The right hotel follows.

An [MCP](https://modelcontextprotocol.io) server, a command line and an agent skill over the
[doalu.com](https://doalu.com) guide. For each city, region and district it names the areas to stay in, who each one
suits and why, and links its page on doalu.com.

```console
$ npx -y github:Doalu/doalu-mcp where-to-stay bergen
Where to stay in Bergen (Vestland, Norway): https://doalu.com/no/vestland/bergen/

- Bryggen and the harbour
  Best for: visitors wanting the Hanseatic wharf and the Fløyen funicular
  Why: hotels by Bryggen, the fish market and the funicular station
- Sandviken below Bergenhus festning
  Best for: travellers wanting old timber streets near the fortress
  Why: timber-house lodgings by St Mary's Church and Sandvikskirken
...
```

No API key, no account, no dependencies. It reads only the public, static guide files at
`https://doalu.com/api/v1/` (Node.js 18 or later).

## MCP server

Add it to your MCP client (Claude Desktop, Claude Code, Cursor, VS Code and others) as a stdio server:

```json
{
  "mcpServers": {
    "doalu": { "command": "npx", "args": ["-y", "github:Doalu/doalu-mcp"] }
  }
}
```

Claude Code: `claude mcp add doalu -- npx -y github:Doalu/doalu-mcp`. Claude Desktop can also install the
`doalu-mcp-<version>.mcpb` bundle from the [releases](https://github.com/Doalu/doalu-mcp/releases).

| Tool | Input | Answer |
|---|---|---|
| `find_place` | `query`: a name, optionally `", country, region or city"` (`"London, UK"`, `"Portland, OR"`); `kind`; `limit` | matching countries, regions, cities and districts: where each lies, population, page link |
| `where_to_stay` | `place`: a name as above, or a doalu.com page URL | the stay areas, who each one suits and why, page links |
| `list_areas` | `place` | the stay areas and the places within it, with links |

Every answer names the doalu.com page it comes from. Please show that link to your users: the page has the full
guide and the hotels in each area. Names are matched in English ("Copenhagen", not "København"). A qualifier that
matches nothing is dropped, and the answer says so.

## Command line

```console
npx -y github:Doalu/doalu-mcp where-to-stay "Springfield, Illinois"
npx -y github:Doalu/doalu-mcp areas malmo
npx -y github:Doalu/doalu-mcp find springfield --json
```

## Agent skill

[`skills/doalu-where-to-stay/SKILL.md`](skills/doalu-where-to-stay/SKILL.md) tells an agent when and how to use the
server, the command line or the files ([Agent Skills](https://agentskills.io) format).

## The data

`https://doalu.com/api/v1/index.json` lists every place; `https://doalu.com/api/v1/{place path}.json` holds one
place: `name`, `kind`, `country`, `url`, `breadcrumb`, `children`, `stay_areas` (`name`, `url`, `best_for`, `why`),
`population`, `timezone` and `wikidata_qid`. The files change with each site build and are served with open CORS.
The list of places is also an open dataset: [github.com/Doalu/places](https://github.com/Doalu/places).

## Licence and credit

Code: MIT. Guide data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with this credit:

> doalu places dataset (https://doalu.com), CC BY 4.0; contains modified GeoNames data (CC BY 4.0,
> https://www.geonames.org) and Wikidata identifiers (CC0). Please link to the page on doalu.com when you use it.

## Development

```console
npm test    # node --test, against real guide files in test/fixtures
DOALU_BASE=http://127.0.0.1:8000 node bin/doalu-mcp.js where-to-stay bergen   # another copy of the files
python3 ../../scripts/publish-doalu-mcp.py --write-hash   # after a change to bin/, src/ or manifest.json
```
