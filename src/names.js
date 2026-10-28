// What travellers type that the guide's own names do not hold: country nicknames and codes, the postal codes of
// US states, Canadian provinces and Australian states, and a few city abbreviations. Keys and values are folded
// (guide.js `fold`); a qualifier expands to every value it may stand for ("wa": Washington or Western Australia).

export const COUNTRY_ALIASES = {
  uk: "gb", "u k": "gb", britain: "gb", "great britain": "gb", usa: "us", "u s a": "us", "u s": "us", america: "us",
  "united states of america": "us", holland: "nl", "the netherlands": "nl", czechia: "cz", korea: "kr", uae: "ae",
  emirates: "ae", "cote d ivoire": "ci", burma: "mm", turkiye: "tr", swaziland: "sz", "east timor": "tl",
  "cabo verde": "cv", macao: "mo", "viet nam": "vn", "south korea": "kr",
};

export const SUBDIVISIONS = {
  // US states and DC
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
  de: "delaware", dc: "district of columbia", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine",
  md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri",
  mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico",
  ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon",
  pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
  ut: "utah", vt: "vermont", va: "virginia", wa: ["washington", "western australia"], wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", pr: "puerto rico",
  // Canadian provinces and territories
  ab: "alberta", bc: "british columbia", mb: "manitoba", nb: "new brunswick", nl: "newfoundland and labrador",
  ns: "nova scotia", nt: "northwest territories", nu: "nunavut", on: "ontario", pe: "prince edward island",
  qc: "quebec", sk: "saskatchewan", yt: "yukon",
  // Australian states and territories
  nsw: "new south wales", vic: "victoria", qld: "queensland", tas: "tasmania", act: "australian capital territory",
};

/** Whole-query abbreviations of city names. */
export const NAME_ALIASES = { nyc: "new york city", sf: "san francisco", la: "los angeles" };

/** Every folded form a qualifier may stand for, itself first. */
export function qualifierForms(w) {
  const forms = [w];
  if (COUNTRY_ALIASES[w]) forms.push(COUNTRY_ALIASES[w]);
  const sub = SUBDIVISIONS[w];
  if (sub) forms.push(...(Array.isArray(sub) ? sub : [sub]));
  if (NAME_ALIASES[w]) forms.push(NAME_ALIASES[w]); // "Hollywood, LA": Los Angeles as well as Louisiana
  return forms;
}
