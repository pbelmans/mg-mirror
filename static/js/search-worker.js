/* Search the complete archive away from the UI thread. No external dependencies. */
let rows = [];
let catalog;
let ready;
let lastMatches;
let lastKey;
const fold = value => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ø/g, "o").replace(/ł/g, "l");

async function getJSON(url, cache = "force-cache") {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`Could not load the search index (HTTP ${response.status}).`);
  return response.json();
}

async function initialize(base) {
  const started = performance.now();
  catalog = await getJSON(`${base}data/catalog.json`, "no-cache");
  const chunks = new Array(catalog.shards);
  let next = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < catalog.shards) {
      const shard = next++;
      const batch = await getJSON(`${base}data/search-${String(shard).padStart(2, "0")}.json?v=${catalog.commit}`);
      for (const row of batch) row.push(fold(row[1]));
      chunks[shard] = batch;
      self.postMessage({ type: "progress", completed: ++completed, total: catalog.shards });
    }
  }));
  rows = chunks.flat();
  self.postMessage({ type: "ready", records: rows.length, loadMs: performance.now() - started });
}

function search(query) {
  const started = performance.now();
  const key = JSON.stringify([query.q, query.school, query.country, query.subject, query.from, query.to, query.sort]);
  if (key !== lastKey) {
    const words = fold(query.q).trim().split(/\s+/).filter(Boolean);
    const school = fold(query.school);
    const schoolMatches = school ? new Set(catalog.schools.flatMap((name, i) => fold(name).includes(school) ? [i] : [])) : null;
    const country = query.country ? catalog.countries.indexOf(query.country) : null;
    const subject = query.subject ? catalog.subjects.indexOf(query.subject) : null;
    const exactID = /^\d+$/.test(query.q.trim()) ? Number(query.q.trim()) : null;
    const from = query.from ? Number(query.from) : null;
    const to = query.to ? Number(query.to) : null;
    lastMatches = rows.filter(row => {
      if (exactID !== null ? row[0] !== exactID : !words.every(word => row[7].includes(word))) return false;
      if (schoolMatches && !schoolMatches.has(row[3])) return false;
      if (country !== null && row[4] !== country) return false;
      if (subject !== null && row[5] !== subject) return false;
      if (from !== null && (row[2] === null || row[2] < from)) return false;
      if (to !== null && (row[2] === null || row[2] > to)) return false;
      return true;
    });
    const byName = (a, b) => a[7] < b[7] ? -1 : a[7] > b[7] ? 1 : a[0] - b[0];
    if (query.sort === "year-desc") lastMatches.sort((a, b) => (b[2] ?? -Infinity) - (a[2] ?? -Infinity) || byName(a, b));
    else if (query.sort === "year-asc") lastMatches.sort((a, b) => (a[2] ?? Infinity) - (b[2] ?? Infinity) || byName(a, b));
    else if (query.sort === "students") lastMatches.sort((a, b) => b[6] - a[6] || byName(a, b));
    else lastMatches.sort(byName);
    lastKey = key;
  }
  const pages = Math.max(1, Math.ceil(lastMatches.length / 50));
  const page = Math.min(Math.max(1, Number(query.page) || 1), pages);
  const results = lastMatches.slice((page - 1) * 50, page * 50).map(r => ({
    id: r[0], name: r[1], year: r[2], school: catalog.schools[r[3]] || "Not recorded",
    country: catalog.countries[r[4]] || "Not recorded", subject: catalog.subjects[r[5]] || "Not recorded", students: r[6],
  }));
  return { results, total: lastMatches.length, page, pages, elapsedMs: performance.now() - started };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      if (!ready) ready = initialize(data.base).catch(error => { ready = undefined; throw error; });
      await ready;
    } else if (data.type === "search") {
      if (!ready) throw new Error("Search index has not been initialized.");
      await ready;
      self.postMessage({ type: "results", requestId: data.requestId, ...search(data.query) });
    }
  } catch (error) {
    self.postMessage({ type: "error", requestId: data.requestId, message: error.message });
  }
};
