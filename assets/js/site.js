"use strict";
const base = document.body.dataset.base || "/";
const snapshot = document.body.dataset.snapshot || "";
const urlFor = path => `${base}${path}`;
const personURL = id => urlFor(`people/${id}/`);
const formatNumber = value => Number(value).toLocaleString("en-US");
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
async function getJSON(path) {
  const response = await fetch(`${urlFor(path)}?v=${snapshot}`, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Unable to load archive data (HTTP ${response.status}). Please try again.`);
  return response.json();
}

document.querySelectorAll(".random-record").forEach(button => button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    const ids = await getJSON("data/ids.json");
    window.location.assign(personURL(ids[Math.floor(Math.random() * ids.length)]));
  } catch (error) {
    button.textContent = "Could not load. Try again ↗";
    button.disabled = false;
  }
}));

const studentOrder = document.getElementById("student-order");
if (studentOrder) {
  const tbody = document.querySelector("#students-table tbody");
  const sort = () => {
    const rows = Array.from(tbody.rows);
    const byName = (a, b) => a.cells[0].textContent.localeCompare(b.cells[0].textContent);
    const year = row => Number(row.cells[2].textContent) || Infinity;
    rows.sort((a, b) => studentOrder.value === "year" ? year(a) - year(b) || byName(a, b) : byName(a, b));
    tbody.replaceChildren(...rows);
  };
  studentOrder.addEventListener("change", sort);
  sort();
}

const searchForm = document.getElementById("search-form");
if (searchForm) setupSearch();

async function setupSearch() {
  const status = document.getElementById("search-status");
  const resultContainer = document.getElementById("search-results");
  const pagination = document.getElementById("pagination");
  const progress = document.getElementById("search-progress");
  const order = document.getElementById("result-order");
  const names = ["q", "school", "country", "subject", "from", "to"];
  const controls = Object.fromEntries(names.map(name => [name, searchForm.elements.namedItem(name)]));
  let worker;
  let requestId = 0;
  let currentPage = 1;
  let catalogReady = false;
  const restore = () => {
    const params = new URLSearchParams(window.location.search);
    for (const name of names) controls[name].value = params.get(name) || "";
    order.value = params.get("sort") || "name";
    if (!order.value) order.value = "name";
    currentPage = Math.max(1, parseInt(params.get("page"), 10) || 1);
    document.getElementById("search-filters").open = names.some(name => name !== "q" && controls[name].value);
  };
  // Apply text fields immediately, and select values after their options are loaded.
  restore();
  try {
    const catalog = await getJSON("data/catalog.json");
    const schools = document.getElementById("school-options");
    schools.replaceChildren(...catalog.schools.map(name => {
      const option = node("option"); option.value = name; return option;
    }));
    for (const [name, values] of [["country", catalog.countries], ["subject", catalog.subjects]]) {
      controls[name].append(...values.map(value => { const option = node("option", value); option.value = value; return option; }));
    }
    catalogReady = true;
    restore();
    runSearch(currentPage, false);
  } catch (error) { showError(error.message); }

  function showError(message) {
    status.textContent = "Search could not be completed.";
    progress.hidden = true;
    resultContainer.setAttribute("aria-busy", "false");
    const box = node("div", undefined, "error-message");
    box.append(node("p", message));
    const retry = node("button", "Retry search", "secondary-button");
    retry.type = "button";
    retry.addEventListener("click", () => window.location.reload());
    box.append(retry);
    resultContainer.replaceChildren(box);
  }

  function ensureWorker() {
    if (worker) return;
    if (!window.Worker) throw new Error("This browser does not support background search. Please use a current browser.");
    worker = new Worker(urlFor("js/search-worker.js"));
    worker.onerror = () => { showError("The search worker could not start. Reload the page to try again."); worker.terminate(); worker = undefined; };
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        progress.hidden = false; progress.value = data.completed; progress.max = data.total;
        status.textContent = `Loading records… ${Math.round(data.completed / data.total * 100)}%`;
      } else if (data.type === "results" && data.requestId === requestId) {
        renderResults(data);
      } else if (data.type === "error") showError(data.message);
    };
    worker.postMessage({ type: "init", base });
  }

  function runSearch(page = 1, updateURL = true) {
    if (!catalogReady || !searchForm.reportValidity()) return;
    const query = Object.fromEntries(names.map(name => [name, controls[name].value.trim()]));
    if (query.from && query.to && Number(query.from) > Number(query.to)) {
      status.textContent = "The starting year must be no later than the ending year.";
      return;
    }
    query.sort = order.value;
    query.page = page;
    currentPage = page;
    if (updateURL) {
      const params = new URLSearchParams();
      for (const name of names) if (query[name]) params.set(name, query[name]);
      if (query.sort !== "name") params.set("sort", query.sort);
      if (page > 1) params.set("page", page);
      history.pushState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }
    try {
      ensureWorker();
      resultContainer.setAttribute("aria-busy", "true");
      status.textContent = "Searching the archive…";
      worker.postMessage({ type: "search", requestId: ++requestId, query });
    } catch (error) { showError(error.message); }
  }

  function renderResults(data) {
    progress.hidden = true;
    resultContainer.setAttribute("aria-busy", "false");
    currentPage = data.page;
    const first = (data.page - 1) * 50 + 1;
    const last = Math.min(data.page * 50, data.total);
    status.textContent = data.total ? `${formatNumber(data.total)} ${data.total === 1 ? "record" : "records"} · showing ${formatNumber(first)}–${formatNumber(last)}` : "No matching records";
    status.dataset.searchMs = data.elapsedMs.toFixed(2);
    resultContainer.replaceChildren();
    pagination.replaceChildren();
    if (!data.total) {
      const box = node("div", undefined, "empty-results");
      box.append(node("h2", "No matching mathematicians"), node("p", "Try fewer name fragments, a broader year range, or clearing a filter."));
      resultContainer.append(box); return;
    }
    const table = node("table", undefined, "record-table");
    const head = node("thead"); const header = node("tr");
    ["Mathematician", "Institution", "Year", "Students"].forEach((text, i) => { const cell = node("th", text, i > 1 ? "numeric" : ""); cell.scope = "col"; header.append(cell); });
    head.append(header); table.append(head);
    const tbody = node("tbody");
    for (const result of data.results) {
      const row = node("tr");
      const nameCell = node("td"); const link = node("a", result.name); link.href = personURL(result.id); nameCell.append(link);
      row.append(nameCell, node("td", result.school), node("td", result.year ?? "—", "numeric"), node("td", formatNumber(result.students), "numeric"));
      tbody.append(row);
    }
    table.append(tbody); const wrap = node("div", undefined, "table-wrap"); wrap.append(table); resultContainer.append(wrap);
    if (data.pages > 1) {
      const previous = node("button", "← Previous"); previous.type = "button"; previous.disabled = data.page <= 1;
      const next = node("button", "Next →"); next.type = "button"; next.disabled = data.page >= data.pages;
      previous.addEventListener("click", () => { runSearch(data.page - 1); status.scrollIntoView({ block: "start" }); });
      next.addEventListener("click", () => { runSearch(data.page + 1); status.scrollIntoView({ block: "start" }); });
      pagination.append(previous, node("span", `Page ${formatNumber(data.page)} of ${formatNumber(data.pages)}`), next);
    }
  }
  searchForm.addEventListener("submit", event => { event.preventDefault(); runSearch(); });
  order.addEventListener("change", () => runSearch());
  document.getElementById("reset-search").addEventListener("click", () => { searchForm.reset(); order.value = "name"; runSearch(); });
  window.addEventListener("popstate", () => { restore(); runSearch(currentPage, false); });
}

const personID = document.body.dataset.person;
const genealogy = document.getElementById("genealogy");
if (personID && genealogy) {
  const openGenealogy = () => {
    if (!genealogy.open) return;
    genealogy.removeEventListener("toggle", openGenealogy);
    const controls = node("div", undefined, "inline-controls");
    const direction = node("select"); direction.id = "tree-direction"; direction.setAttribute("aria-label", "Relationship direction");
    for (const [value, title] of [["advisors", "Ancestors"], ["students", "Descendants"]]) {
      const option = node("option", title); option.value = value; direction.append(option);
    }
    const depth = node("select"); depth.id = "tree-depth"; depth.setAttribute("aria-label", "Generations");
    for (const value of [2, 3, 4]) {
      const option = node("option", `${value} generations`); option.value = value; depth.append(option);
    }
    controls.append(direction, depth);
    const tree = node("div", "Loading…", "person-tree"); tree.id = "person-tree";
    const caption = node("p", undefined, "figure-caption"); caption.id = "tree-caption";
    genealogy.append(controls, tree, caption);
    setupGenealogy(Number(personID));
  };
  genealogy.addEventListener("toggle", openGenealogy);
  openGenealogy();
}

async function setupGenealogy(id) {
  const container = document.getElementById("person-tree");
  const direction = document.getElementById("tree-direction");
  const depth = document.getElementById("tree-depth");
  const caption = document.getElementById("tree-caption");
  const buckets = new Map();
  let renderVersion = 0;
  const getRecord = async recordID => {
    const bucket = Math.floor(recordID / 1000);
    if (!buckets.has(bucket)) buckets.set(bucket, getJSON(`data/graph/${bucket}.json`));
    try { return (await buckets.get(bucket))[String(recordID)]; }
    catch (error) { buckets.delete(bucket); throw error; }
  };
  async function draw() {
    const version = ++renderVersion;
    container.setAttribute("aria-busy", "true");
    const ancestor = direction.value === "advisors";
    const relation = ancestor ? 2 : 3;
    try {
      let level = [id];
      const seen = new Set([id]);
      const levels = [];
      const connections = new Map();
      let truncated = false;
      for (let generation = 0; generation <= Number(depth.value) && level.length; generation++) {
        const visible = level.slice(0, 12);
        if (level.length > visible.length) truncated = true;
        const records = await Promise.all(visible.map(async recordID => [recordID, await getRecord(recordID)]));
        levels.push(records);
        const next = [];
        for (const [recordID, record] of records) {
          if (!record) continue;
          for (const relative of record[relation]) {
            if (!connections.has(relative)) connections.set(relative, new Set());
            connections.get(relative).add(record[0]);
            if (!seen.has(relative)) { seen.add(relative); next.push(relative); }
          }
        }
        level = next;
      }
      if (version !== renderVersion) return;
      const wrapper = node("div", undefined, "genealogy-levels");
      levels.forEach((records, generation) => {
        const column = node("div", undefined, "genealogy-level");
        column.append(node("h3", generation === 0 ? "This record" : `${ancestor ? "Ancestors" : "Descendants"} · generation ${generation}`));
        for (const [recordID, record] of records) {
          const link = node("a", record ? record[0] : `MGP ${recordID} (unavailable)`, `genealogy-card${generation === 0 ? " current" : ""}`);
          link.href = personURL(recordID);
          link.append(node("span", record && record[1] ? String(record[1]) : "Year not recorded"));
          if (generation > 0 && connections.has(recordID)) link.append(node("small", `${ancestor ? "Advisor to" : "Student of"} ${[...connections.get(recordID)].join("; ")}`));
          column.append(link);
        }
        wrapper.append(column);
      });
      container.replaceChildren(wrapper);
      caption.textContent = truncated ? "Showing up to 12 people per generation. Open a record to explore branches omitted here." : "Select a name to open its record. People shared by multiple branches are shown once.";
      if (levels.length === 1) caption.textContent = `No ${ancestor ? "advisors" : "students"} recorded for this mathematician in the snapshot.`;
    } catch (error) {
      if (version === renderVersion) container.replaceChildren(node("p", error.message, "error-message"));
    } finally { if (version === renderVersion) container.setAttribute("aria-busy", "false"); }
  }
  direction.addEventListener("change", draw); depth.addEventListener("change", draw); draw();
}

if (/\/id\.php\/?$/.test(window.location.pathname)) {
  const id = new URLSearchParams(window.location.search).get("id");
  if (id && /^[1-9]\d*$/.test(id)) window.location.replace(personURL(id));
  else {
    const message = document.getElementById("legacy-message");
    if (message) message.textContent = "No valid MGP identifier was supplied. Search for a mathematician below.";
  }
}
