// The doalu.com guide data: the static files at https://doalu.com/api/v1/ (index.json lists every
// place; {place path}.json holds one place's stay areas, children and breadcrumb). Read-only, no
// state beyond an in-memory cache of the index. Every answer carries the doalu.com page link.

import { NAME_ALIASES, qualifierForms } from "./names.js";

export const DEFAULT_BASE = "https://doalu.com";
export const VERSION = "0.1.0";
export const CREDIT =
  "Source: doalu.com (CC BY 4.0). Link to the doalu.com page when you use this.";

const INDEX_TTL_MS = 24 * 60 * 60 * 1000; // the files change only with a site build
const KIND_RANK = { city: 3, country: 2, region: 1, district: 0 };
const DETAIL_LIMIT = 10; // results whose own file is read for breadcrumb and population
const FETCH_TIMEOUT_MS = 20_000; // a stalled request fails the call instead of hanging it

/** Lowercase, accents and punctuation folded: "Malmö" -> "malmo", "Saint-Étienne" -> "saint etienne". */
export function fold(s) {
  return String(s)
    .toLowerCase()
    .replace(/[øœæßłđðþ]/g, (c) => ({ ø: "o", œ: "oe", æ: "ae", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th" })[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export class Guide {
  constructor({ base = DEFAULT_BASE, fetch: fetchFn = globalThis.fetch } = {}) {
    this.base = base.replace(/\/+$/, "");
    this.fetch = fetchFn;
    this.index = null;
    this.indexAt = 0;
    this.indexLoading = null; // one fetch of the index however many calls wait for it
  }

  /** The guide file URL for an `api` link or a place path, on this guide's base. */
  apiUrl(apiOrPath) {
    let path = apiOrPath.replace(/^https?:\/\/[^/]+/, "");
    if (!path.startsWith("/api/v1/")) path = `/api/v1/${path.replace(/^\/+|\/+$/g, "")}.json`;
    return this.base + path;
  }

  async getJson(url) {
    const res = await this.fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = new Error(`${url}: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async loadIndex() {
    if (this.index && Date.now() - this.indexAt <= INDEX_TTL_MS) return this.index;
    this.indexLoading ??= this.readIndex().finally(() => {
      this.indexLoading = null;
    });
    return this.indexLoading;
  }

  async readIndex() {
    const idx = await this.getJson(`${this.base}/api/v1/index.json`);
    const countries = new Map();
    const byPath = new Map();
    for (const p of idx.places) {
      if (p.kind === "country") countries.set(p.country, p.name);
      byPath.set(new URL(p.url).pathname, p.name);
    }
    this.index = idx.places.map((p) => {
      const segments = new URL(p.url).pathname.split("/").filter(Boolean);
      // what a qualifier may name: each level above the place, by its name and by its path slug
      const above = [];
      for (let i = 1; i < segments.length; i++) {
        const name = byPath.get(`/${segments.slice(0, i).join("/")}/`);
        if (name) above.push(fold(name));
        above.push(segments[i - 1].replace(/-/g, " "));
      }
      return {
        ...p,
        folded: fold(p.name),
        countryName: countries.get(p.country) ?? p.country,
        above: [fold(p.country), fold(countries.get(p.country) ?? ""), ...above].filter(Boolean),
      };
    });
    this.indexAt = Date.now();
    return this.index;
  }

  async place(apiOrPath) {
    return this.getJson(this.apiUrl(apiOrPath));
  }

  /**
   * Places matching `query` ("Bergen", "Bergen, Norway", "Springfield, Illinois", "Malmo"), best
   * first: exact name, then name prefix, then a word in the name; a qualifier after a comma must
   * match the country (name or code) or a level of the page path. The top results carry their
   * breadcrumb and population (read from their own files); ties go to the larger place.
   */
  async find(query, { limit = 5, kind } = {}) {
    const index = await this.loadIndex();
    // Commas split the name from its qualifiers, but a name may hold commas itself ("Sant Pere, Santa
    // Caterina i La Ribera"): every split is tried, the name as long as it can be first, best score kept.
    const parts = String(query).split(",");
    // One pass: the longest name that matches (with `useQualifiers`, the parts after it must all qualify).
    // Returns the matches, the split used and the "X City" candidates.
    const search = (useQualifiers) => {
      const best = new Map();
      const pairs = [];
      let used = parts.length;
      for (let k = parts.length; k >= 1; k--) {
        let q = fold(parts.slice(0, k).join(","));
        if (!q) continue;
        q = NAME_ALIASES[q] ?? q;
        const qualifiers = useQualifiers ? parts.slice(k).map(fold).filter(Boolean) : [];
        if (!useQualifiers && k < parts.length && best.size) break;
        const exactAbove = [];
        for (const p of index) {
          if (kind && p.kind !== kind) continue;
          let score;
          if (p.folded === q) score = 3;
          else if (p.folded.startsWith(q)) score = 2;
          else if (` ${p.folded} `.includes(` ${q} `)) score = 1;
          else continue;
          if (!qualifiers.every((w) => matchesQualifier(p, w))) continue;
          if (score === 3 && (p.kind === "country" || p.kind === "region")) exactAbove.push(p);
          if (score > (best.get(p)?.score ?? 0)) best.set(p, { p, score });
          used = k;
        }
        // "New York", "Mexico", "Panama": candidates for the city "X City" (or "City of X") inside the region or
        // country X. Never under a `kind` filter: "only places of this kind" (review r2).
        if (kind) continue;
        for (const r of exactAbove) {
          for (const p of index) {
            if (p.kind === "city" && (p.folded === `${q} city` || p.folded === `city of ${q}`) && p.url.startsWith(r.url)
                && qualifiers.every((w) => matchesQualifier(p, w))) {
              pairs.push({ r, p });
            }
          }
        }
      }
      return { best, pairs, used };
    };
    let { best, pairs, used } = search(true);
    let qualifierIgnored = null;
    if (!best.size && parts.length > 1) {
      // A qualifier the guide does not know ("Bergen, Peru", "Hollywood, Europe"): the name alone, keeping every
      // qualifier that still matches one of its places, and the answer names the dropped ones.
      ({ best, pairs, used } = search(false));
      const quals = parts.slice(used).map((x) => x.trim()).filter(Boolean);
      const kept = quals.filter((w) => [...best.keys()].some((p) => matchesQualifier(p, fold(w))));
      if (kept.length) {
        for (const p of [...best.keys()]) if (!kept.every((w) => matchesQualifier(p, fold(w)))) best.delete(p);
        pairs = pairs.filter(({ p }) => kept.every((w) => matchesQualifier(p, fold(w))));
      }
      if (best.size) qualifierIgnored = quals.filter((w) => !kept.includes(w)).join(", ") || null;
    }
    // The city answers before X only while X holds no stay areas of its own (agent-surfaces.md, as built 139):
    // checked on X's file, so a build that gives X stay areas turns the rule off by itself (review r2).
    for (const { r, p } of pairs) {
      let rFile = null;
      try {
        rFile = await this.place(r.api);
      } catch {
        // unreadable: X keeps its place
      }
      if (rFile && rFile.stay_areas.length === 0) best.set(p, { p, score: 3.5 });
    }
    const scored = [...best.values()];
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        KIND_RANK[b.p.kind] - KIND_RANK[a.p.kind] ||
        a.p.name.length - b.p.name.length ||
        a.p.url.localeCompare(b.p.url),
    );
    const top = scored.slice(0, Math.max(limit, DETAIL_LIMIT));
    const detailed = await Promise.all(
      top.map(async ({ p, score }) => {
        let file = null;
        try {
          file = await this.place(p.api);
        } catch {
          // listed in the index but unreadable: still a result, without detail
        }
        return {
          score,
          name: p.name,
          kind: p.kind,
          country: p.country,
          countryName: p.countryName,
          url: p.url,
          api: p.api,
          within: file ? file.breadcrumb.map((b) => b.name).reverse() : [],
          population: file?.population ?? null,
          stayAreas: file ? file.stay_areas.length : null,
        };
      }),
    );
    detailed.sort(
      (a, b) =>
        b.score - a.score ||
        KIND_RANK[b.kind] - KIND_RANK[a.kind] ||
        (b.population ?? 0) - (a.population ?? 0),
    );
    const out = detailed.slice(0, limit).map(({ score, ...r }) => r);
    out.qualifierIgnored = qualifierIgnored;
    return out;
  }

  /** One place's guide file: `place` is a name (best match), a doalu.com URL or a place path. */
  async resolve(place) {
    const s = String(place).trim();
    const path = placePath(s);
    if (path) {
      try {
        return { file: await this.place(path), others: [], qualifierIgnored: null };
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    const found = await this.find(s, { limit: 4 });
    if (!found.length) return { file: null, others: [], qualifierIgnored: null };
    return { file: await this.place(found[0].api), others: found.slice(1), qualifierIgnored: found.qualifierIgnored };
  }
}

/**
 * The place path of a doalu.com page or guide-file URL, or of a bare path: scheme and www optional, any case,
 * query and fragment dropped ("doalu.com/NO/vestland/bergen#areas" -> "no/vestland/bergen"). Null for a name.
 */
export function placePath(s) {
  let u;
  if (/^https?:\/\//i.test(s)) u = s;
  else if (/^(www\.)?doalu\.com(\/|$)/i.test(s)) u = `https://${s}`;
  else if (/^\/?[a-z]{2}\/\S*$/i.test(s)) u = `https://doalu.com/${s.replace(/^\/+/, "")}`;
  else return null;
  let url;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (!/^(www\.)?doalu\.com$/i.test(url.hostname)) return null;
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null; // a malformed %-escape: not a page path, so the name search answers (review r2)
  }
  path = path
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/^api\/v1\//, "")
    .replace(/\.json$/, "");
  return /^[a-z]{2}(\/[a-z0-9-]+)*$/.test(path) ? path : null;
}

/** A qualifier names a level above the place, in whole words ("illinois", "skane", "region sjaelland"). */
function matchesQualifier(p, w) {
  return qualifierForms(w).some((f) => p.above.some((a) => ` ${a} `.includes(` ${f} `)));
}

// ---- answers: plain text for people and agents, each with its doalu.com link ----

function where(r) {
  return [...r.within].join(", ") || r.countryName;
}

export function formatFind(query, results) {
  if (!results.length) {
    return `No place on doalu.com matches "${query}". Try the English name, or add the country: "Bergen, Norway".`;
  }
  const lines = results.map((r) => {
    const bits = [r.kind, where(r)];
    if (r.population) bits.push(`population ${r.population.toLocaleString("en-US")}`);
    if (r.stayAreas) bits.push(`${r.stayAreas} stay area${r.stayAreas === 1 ? "" : "s"}`);
    return `- ${r.name} (${bits.join("; ")}): ${r.url}`;
  });
  const head = results.qualifierIgnored
    ? `No place on doalu.com matches "${query}" in "${results.qualifierIgnored}". Places with that name:`
    : `Places on doalu.com matching "${query}":`;
  return `${head}\n${lines.join("\n")}\n\n${CREDIT}`;
}

function title(file) {
  const within = file.breadcrumb.map((b) => b.name).reverse();
  return within.length ? `${file.name} (${within.join(", ")})` : file.name;
}

/** The line saying a qualifier was dropped ("Bergen, Peru" answered with Bergen, Norway). */
function ignored(qualifier) {
  return qualifier ? `No match in "${qualifier}" on doalu.com; the closest place with that name:\n\n` : "";
}

function alsoMeant(others) {
  if (!others.length) return "";
  return `\n\nOther matches: ${others.map((o) => `${o.name}, ${where(o)} (${o.url})`).join("; ")}.`;
}

export function formatWhereToStay(file, others = [], qualifierIgnored = null) {
  const head = `${ignored(qualifierIgnored)}Where to stay in ${title(file)}: ${file.url}`;
  if (!file.stay_areas.length) {
    const kids = file.children.slice(0, 12).map((c) => `- ${c.name} (${c.kind}): ${c.url}`);
    if (file.children.length > kids.length) kids.push(`- and ${file.children.length - kids.length} more on ${file.url}`);
    const more = kids.length ? `\n\nPlaces within it on doalu.com:\n${kids.join("\n")}` : "";
    return `${head}\n\ndoalu.com has no stay-area guide for ${file.name} yet; its page is ${file.url}.${more}${alsoMeant(others)}\n\n${CREDIT}`;
  }
  const areas = file.stay_areas.map((a) => {
    let l = `- ${a.name}${a.url ? ` (${a.url})` : ""}`;
    if (a.best_for) l += `\n  Best for: ${a.best_for}`;
    if (a.why) l += `\n  Why: ${a.why}`;
    return l;
  });
  return `${head}\n\n${areas.join("\n")}\n\nFull guide, with hotels by area: ${file.url}${alsoMeant(others)}\n\n${CREDIT}`;
}

export function formatListAreas(file, others = [], qualifierIgnored = null) {
  const parts = [`${ignored(qualifierIgnored)}Areas of ${title(file)}: ${file.url}`];
  if (file.stay_areas.length) {
    parts.push(`Stay areas:\n${file.stay_areas.map((a) => `- ${a.name}${a.url ? `: ${a.url}` : ""}`).join("\n")}`);
  }
  if (file.children.length) {
    parts.push(`Places within it:\n${file.children.map((c) => `- ${c.name} (${c.kind}): ${c.url}`).join("\n")}`);
  }
  if (parts.length === 1) parts.push(`doalu.com lists no areas within ${file.name} yet.`);
  return `${parts.join("\n\n")}${alsoMeant(others)}\n\n${CREDIT}`;
}

/** The structured form of a place file for clients that read JSON (links kept, nothing added). */
export function structured(file) {
  return {
    name: file.name,
    kind: file.kind,
    country: file.country,
    url: file.url,
    within: file.breadcrumb.map((b) => b.name).reverse(),
    stay_areas: file.stay_areas,
    children: file.children.map(({ name, kind, url }) => ({ name, kind, url })),
    licence: file.licence,
    attribution: file.attribution,
  };
}
