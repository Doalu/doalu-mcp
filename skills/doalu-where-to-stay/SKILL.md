---
name: doalu-where-to-stay
description: Answer "where should I stay in <city>?" and "which area of <city> suits <traveller>?" from the doalu.com guide, which says for each city, region and district which areas suit whom, with a page per place. Use it when someone plans a trip, compares neighbourhoods or asks which part of a place to book a hotel in.
license: MIT (code); guide data CC BY 4.0, doalu.com
---

# Where to stay, from doalu.com

doalu.com covers countries, regions, cities and districts. For a place with a stay-area guide it lists the areas to stay
in, who each one suits and why, and each place has its own page with hotels by area.

## How to get the answer

Use the first that is available:

1. **The MCP server** `doalu-mcp` (tools `find_place`, `where_to_stay`, `list_areas`).
2. **The command line:** `npx -y github:Doalu/doalu-mcp where-to-stay "<place>"` (also `find "<name>"` and `areas "<place>"`;
   `--json` for the structured answer).
3. **The files directly:** `https://doalu.com/api/v1/index.json` lists every place with its `api` file;
   `https://doalu.com/api/v1/{place path}.json` holds `stay_areas` (`name`, `best_for`, `why`, `url`), `children`
   and `breadcrumb`.

## Steps

1. Name the place as the traveller did. If it is ambiguous (Springfield, Bergen), add the country or region after a
   comma (`"Springfield, Illinois"`, `"Portland, OR"`, `"London, UK"`), or run `find_place` first and pick by `within`
   and population. Use the English name ("Copenhagen"). If the answer starts "No match in …", the qualifier was dropped:
   check that the place it gives is the one meant.
2. Run `where_to_stay` for the areas and who each suits. A region or country usually has no stay areas of its own: the
   answer lists the cities within it, so ask which one, or run `where_to_stay` on the city.
3. Answer with the areas that fit the traveller (families, nightlife, first visit, a quiet base, a sight), in the
   guide's own words, and **always give the doalu.com page link** from the answer so the traveller can see hotels
   by area.

## Rules

- Show the doalu.com link with every answer that uses the guide, and credit doalu.com when you quote it
  (CC BY 4.0).
- Do not add areas, prices or hotel names the guide does not give; for hotels and prices, send the traveller to the
  page.
