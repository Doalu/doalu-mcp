import assert from "node:assert/strict";
import { test } from "node:test";
import { CREDIT, Guide, fold, formatFind, formatListAreas, formatWhereToStay } from "../src/guide.js";
import { fixtureFetch, guide } from "./helpers.js";

test("fold: case, accents, ø/æ and punctuation", () => {
  assert.equal(fold("Malmö"), "malmo");
  assert.equal(fold("Møhlenpris"), "mohlenpris");
  assert.equal(fold("Saint-Étienne"), "saint etienne");
  assert.equal(fold("  Landås "), "landas");
});

test("apiUrl: an api link or a place path, on the configured base", () => {
  const g = new Guide({ base: "http://127.0.0.1:9/" });
  assert.equal(g.apiUrl("https://doalu.com/api/v1/no/vestland/bergen.json"), "http://127.0.0.1:9/api/v1/no/vestland/bergen.json");
  assert.equal(g.apiUrl("/no/vestland/bergen/"), "http://127.0.0.1:9/api/v1/no/vestland/bergen.json");
});

test("find: exact name first, the city before a same-named district", async () => {
  const r = await guide().find("bergen");
  assert.equal(r[0].url, "https://doalu.com/no/vestland/bergen/");
  assert.deepEqual(r[0].within, ["Vestland", "Norway"]);
  assert.equal(r[1].url, "https://doalu.com/us/new-jersey/jersey-city/bergen/");
  assert.equal(r[2].name, "Bergenhus"); // a prefix match after every exact one
});

test("find: same name and kind, the larger place first", async () => {
  const r = await guide().find("Springfield");
  assert.deepEqual(r.map((x) => x.url), [
    "https://doalu.com/us/missouri/springfield/",
    "https://doalu.com/us/illinois/springfield/",
    "https://doalu.com/gb/england/wolverhampton/springfield/",
  ]);
  assert.equal(r[0].population, 170188);
});

test("find: a qualifier narrows by country name, country code or region", async () => {
  const g = guide();
  assert.deepEqual((await g.find("Springfield, Illinois")).map((x) => x.url), ["https://doalu.com/us/illinois/springfield/"]);
  assert.deepEqual((await g.find("bergen, norway", { kind: "city" })).map((x) => x.country), ["NO"]);
  assert.deepEqual((await g.find("Bergen, US")).map((x) => x.kind), ["district"]);
  // a qualifier no place matches: the name alone, flagged (review r1: never "no match" for a place the guide has)
  const peru = await g.find("Bergen, Peru");
  assert.equal(peru[0].url, "https://doalu.com/no/vestland/bergen/");
  assert.equal(peru.qualifierIgnored, "Peru");
  assert.equal((await g.find("Bergen, Norway")).qualifierIgnored, null);
});

test("find: accents folded, kind filter, nothing for an empty query", async () => {
  const g = guide();
  assert.equal((await g.find("malmo"))[0].name, "Malmö");
  assert.deepEqual((await g.find("bergen", { kind: "district" })).map((x) => x.country), ["US", "NO"]);
  assert.equal((await g.find(" , ")).length, 0);
});

test("the index is fetched once per process", async () => {
  const f = fixtureFetch();
  const g = new Guide({ base: "https://doalu.test", fetch: f });
  await g.find("bergen");
  await g.find("malmo");
  assert.equal(f.calls.filter((u) => u.endsWith("/api/v1/index.json")).length, 1);
});

test("resolve: a doalu.com URL or path reads that file; a name takes the best match", async () => {
  const g = guide();
  assert.equal((await g.resolve("https://doalu.com/us/missouri/springfield/")).file.name, "Springfield");
  assert.equal((await g.resolve("us/illinois/springfield")).file.url, "https://doalu.com/us/illinois/springfield/");
  const { file, others } = await g.resolve("Bergen");
  assert.equal(file.country, "NO");
  assert.ok(others.some((o) => o.country === "US"));
  assert.equal((await g.resolve("nowhere at all")).file, null);
});

test("where_to_stay text: every area with who it suits and why, the page link and the credit", async () => {
  const { file, others } = await guide().resolve("bergen");
  const t = formatWhereToStay(file, others);
  assert.match(t, /^Where to stay in Bergen \(Vestland, Norway\): https:\/\/doalu\.com\/no\/vestland\/bergen\/\n/);
  for (const a of file.stay_areas) {
    assert.ok(t.includes(`- ${a.name}`), a.name);
    assert.ok(t.includes(`Best for: ${a.best_for}`), a.best_for);
    assert.ok(t.includes(`Why: ${a.why}`), a.why);
  }
  assert.match(t, /Other matches: Bergen, Jersey City, New Jersey, United States \(https:\/\/doalu\.com\/us\/new-jersey\/jersey-city\/bergen\/\)/);
  assert.ok(t.endsWith(CREDIT));
});

test("where_to_stay text for a place without stay areas points to its page and the places within", async () => {
  const g = guide();
  const file = await g.place("no/vestland");
  assert.equal(file.stay_areas.length, 0);
  const t = formatWhereToStay(file);
  assert.match(t, /no stay-area guide for Vestland yet; its page is https:\/\/doalu\.com\/no\/vestland\//);
  const first = file.children[0];
  assert.ok(t.includes(`- ${first.name} (${first.kind}): ${first.url}`));
  assert.ok(file.children.length > 12);
  assert.ok(t.includes(`- and ${file.children.length - 12} more on https://doalu.com/no/vestland/`));
});

test("list_areas text: stay areas and places within, each with its link", async () => {
  const file = await guide().place("no/vestland/bergen");
  const t = formatListAreas(file);
  assert.match(t, /^Areas of Bergen \(Vestland, Norway\): https:\/\/doalu\.com\/no\/vestland\/bergen\//);
  assert.match(t, /- Bryggen and the harbour\n/);
  for (const c of file.children) assert.ok(t.includes(`- ${c.name} (${c.kind}): ${c.url}`), c.name);
});

test("no-result text suggests adding the country", () => {
  assert.match(formatFind("zzz", []), /No place on doalu\.com matches "zzz"/);
});

test("find: a qualifier may name a level above by its name where the path slug differs", async () => {
  const g = guide();
  // Region Sjælland's path slug is region-zealand (sweep-139: 280 of 16,707 places unfindable by "<name>, <parent>")
  assert.equal((await g.find("Vordingborg, Region Sjælland"))[0]?.url, "https://doalu.com/dk/region-zealand/vordingborg/");
  assert.equal((await g.find("Vordingborg, Denmark"))[0]?.url, "https://doalu.com/dk/region-zealand/vordingborg/");
  // Skåne County's path slug is skane-county; its name folds to "skane county": both qualify
  assert.equal((await g.find("Malmö, Skåne County"))[0]?.url, "https://doalu.com/se/skane-county/malmo/");
  assert.equal((await g.find("Malmö, Skane"))[0]?.url, "https://doalu.com/se/skane-county/malmo/");
  // a parent city qualifies a district
  assert.deepEqual((await g.find("Bergen, Jersey City")).map((x) => x.kind), ["district"]);
  assert.equal((await g.find("Malmö, Norway")).qualifierIgnored, "Norway");
});

test("find: a name that holds a comma, alone or with its own qualifier", async () => {
  const g = guide();
  const url = "https://doalu.com/gb/england/liverpool/new-hall-fazakerley/";
  assert.equal((await g.find("New Hall, Fazakerley"))[0]?.url, url);
  assert.equal((await g.find("New Hall, Fazakerley, Liverpool"))[0]?.url, url);
  assert.equal((await g.find("Bergen, Norway"))[0]?.url, "https://doalu.com/no/vestland/bergen/");
});

test("find: country nicknames and codes, US/CA/AU subdivision codes as qualifiers (review r1)", async () => {
  const g = guide();
  const first = async (q) => (await g.find(q))[0]?.url;
  assert.equal(await first("London, UK"), "https://doalu.com/gb/england/london/");
  assert.equal(await first("Springfield, USA"), "https://doalu.com/us/missouri/springfield/");
  assert.equal(await first("Springfield, IL"), "https://doalu.com/us/illinois/springfield/");
  assert.equal(await first("Portland, OR"), "https://doalu.com/us/oregon/portland/");
  assert.equal(await first("Portland, ME"), "https://doalu.com/us/maine/portland/");
  assert.equal(await first("Portland, Maine"), "https://doalu.com/us/maine/portland/");
  for (const q of ["London, UK", "Springfield, IL", "Portland, ME"]) assert.equal((await g.find(q)).qualifierIgnored, null, q);
});

test("find: the city 'X City' inside region or country X answers first (review r1: 'Mexico' -> Mexico City)", async () => {
  const g = guide();
  const r = await g.find("Mexico");
  assert.equal(r[0].url, "https://doalu.com/mx/ciudad-de-mexico/mexico-city/");
  assert.ok(r.some((x) => x.url === "https://doalu.com/mx/"), "the country is still listed");
  assert.equal((await g.resolve("Mexico")).file.name, "Mexico City");
});

test("resolve: page URLs with fragment, query, www, upper case, no scheme, or a guide-file URL (review r1)", async () => {
  const g = guide();
  for (const u of [
    "https://doalu.com/no/vestland/bergen/#areas",
    "https://doalu.com/no/vestland/bergen/?x=1",
    "doalu.com/no/vestland/bergen",
    "www.doalu.com/no/vestland/bergen/",
    "HTTPS://WWW.DOALU.COM/NO/Vestland/Bergen/",
    "/NO/vestland/bergen/",
    "https://doalu.com/api/v1/no/vestland/bergen.json",
  ]) {
    assert.equal((await g.resolve(u)).file?.url, "https://doalu.com/no/vestland/bergen/", u);
  }
});

test("placePath: names and other hosts are not paths", async () => {
  const { placePath } = await import("../src/guide.js");
  assert.equal(placePath("Bergen"), null);
  assert.equal(placePath("Bergen, Norway"), null);
  assert.equal(placePath("https://example.com/no/vestland/bergen/"), null);
  assert.equal(placePath("doalu.com/no/vestland/bergen?x#y"), "no/vestland/bergen");
});

test("'NYC' and 'New York' find New York City first (review r1)", async () => {
  const g = guide();
  assert.equal((await g.find("NYC"))[0]?.url, "https://doalu.com/us/new-york/new-york-city/");
  assert.equal((await g.find("New York"))[0]?.url, "https://doalu.com/us/new-york/new-york-city/");
});

test("concurrent calls share one index fetch; requests carry a timeout signal (review r1)", async () => {
  const f = fixtureFetch();
  const seen = [];
  const g = new Guide({ base: "https://doalu.test", fetch: (u, o) => (seen.push(o.signal), f(u)) });
  await Promise.all([g.find("bergen"), g.find("malmo"), g.loadIndex()]);
  assert.equal(f.calls.filter((u) => u.endsWith("/api/v1/index.json")).length, 1);
  assert.ok(seen.every((sig) => sig instanceof AbortSignal));
});

test("X City never overrides a kind filter (review r2)", async () => {
  const g = guide();
  assert.deepEqual((await g.find("New York", { kind: "region" })).map((x) => x.url), ["https://doalu.com/us/new-york/"]);
  assert.deepEqual((await g.find("Mexico", { kind: "country" })).map((x) => x.url), ["https://doalu.com/mx/"]);
  assert.equal((await g.find("Mexico", { kind: "city" }))[0].url, "https://doalu.com/mx/ciudad-de-mexico/mexico-city/");
});

test("X City only while X holds no stay areas of its own (review r2)", async () => {
  const f = fixtureFetch();
  const withAreas = async (url, o) => {
    const res = await f(url, o);
    if (!url.endsWith("/api/v1/mx.json")) return res;
    const body = await res.json();
    return { ok: true, status: 200, json: async () => ({ ...body, stay_areas: [{ name: "Somewhere" }] }) };
  };
  const g = new Guide({ base: "https://doalu.test", fetch: withAreas });
  assert.equal((await g.find("Mexico"))[0].url, "https://doalu.com/mx/");
});

test("a malformed %-escape is not a URL error: the name search answers (review r2)", async () => {
  const g = guide();
  const { placePath } = await import("../src/guide.js");
  assert.equal(placePath("https://doalu.com/no/vestland/bergen/%E0"), null);
  const r = await g.resolve("https://doalu.com/no/vestland/bergen/%E0");
  assert.equal(r.file, null);
});

test("only the qualifiers that match nothing are dropped and named (review r2)", async () => {
  const g = guide();
  const r = await g.find("Bergen, Norway, Europe");
  assert.equal(r[0].url, "https://doalu.com/no/vestland/bergen/");
  assert.ok(r.every((x) => x.country === "NO"), "Norway still filters: no Bergen, US"); // Bergenhus is a NO prefix match
  assert.equal(r.qualifierIgnored, "Europe");
  assert.equal((await g.find("Bergen, Peru")).qualifierIgnored, "Peru");
});

test("'LA' as a qualifier also means Los Angeles (review r2)", async () => {
  const { qualifierForms } = await import("../src/names.js");
  assert.deepEqual(qualifierForms("la"), ["la", "louisiana", "los angeles"]);
});
