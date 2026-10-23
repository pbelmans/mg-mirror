// Exercise the browser worker unchanged, inside a real Node worker thread.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const root = fileURLToPath(new URL("../", import.meta.url));
const records = Object.values(JSON.parse(await readFile(`${root}data/records.json`, "utf8")));
const worker = new Worker(`
  const { parentPort, workerData } = require('node:worker_threads');
  const fs = require('node:fs/promises');
  const vm = require('node:vm');
  global.self = { postMessage: value => parentPort.postMessage(value) };
  global.fetch = async path => {
    const body = await fs.readFile(workerData + 'static' + path.split('?')[0], 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
  fs.readFile(workerData + 'static/js/search-worker.js', 'utf8').then(code => {
    vm.runInThisContext(code);
    parentPort.on('message', data => self.onmessage({ data }));
    parentPort.postMessage({ type: 'booted' });
  });
`, { eval: true, workerData: root });

const queue = [];
let listener;
worker.on("message", value => {
  if (listener) { const resolve = listener; listener = null; resolve(value); }
  else queue.push(value);
});
const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { listener = resolve; });
let requestID = 0;
const timings = [];
async function query(values) {
  const requestId = ++requestID;
  worker.postMessage({ type: "search", requestId, query: { q: "", school: "", country: "", subject: "", from: "", to: "", sort: "name", page: 1, ...values } });
  for (;;) {
    const result = await next();
    assert.notEqual(result.type, "error", result.message);
    if (result.type === "results" && result.requestId === requestId) {
      timings.push({ query: JSON.stringify(values), milliseconds: Number(result.elapsedMs.toFixed(2)), matches: result.total });
      return result;
    }
  }
}
try {
  assert.equal((await next()).type, "booted");
  worker.postMessage({ type: "init", base: "/" });
  for (;;) {
    const message = await next();
    assert.notEqual(message.type, "error", message.message);
    if (message.type === "ready") {
      assert.equal(message.records, 338532);
      console.log(`Index parsed and normalized in ${message.loadMs.toFixed(0)} ms (local filesystem, no network latency).`);
      break;
    }
  }
  const emmy = await query({ q: "Emmy Noether" });
  assert.deepEqual(emmy.results.map(r => r.id), [6967]);
  assert.deepEqual((await query({ q: "NOETHER EMMY" })).results.map(r => r.id), [6967]);
  const gauss = await query({ q: "gauss" });
  assert(gauss.results.some(r => r.id === 18231), "ß must match ss");
  assert.deepEqual((await query({ q: "6967" })).results.map(r => r.id), [6967]);
  const nonexistent = await query({ q: "there-is-no-mathematician-with-this-name-xyz" });
  assert.equal(nonexistent.total, 0);
  const germany = await query({ country: "Germany", from: "1900", to: "1909" });
  assert.equal(germany.total, records.filter(r => r.country_display === "Germany" && r.year >= 1900 && r.year <= 1909).length);
  const subject = "14—Algebraic geometry";
  const algebraicGeometry = await query({ subject });
  assert.equal(algebraicGeometry.total, records.filter(r => r.subject === subject).length);
  const harvard = await query({ school: "Harvard University", from: "2004", to: "2004" });
  assert(harvard.results.some(r => r.id === 91093));
  const all = await query({});
  assert.equal(all.total, 338532);
  assert.equal(all.results.length, 50);
  assert.equal(all.pages, Math.ceil(338532 / 50));
  const second = await query({ page: 2 });
  assert(!second.results.some(r => all.results.some(first => first.id === r.id)));
  const last = await query({ page: 999999 });
  assert.equal(last.page, last.pages);
  assert.equal(last.results.length, 338532 % 50);
  const students = await query({ sort: "students" });
  assert.equal(students.results[0].students, records.reduce((max, r) => Math.max(max, r.students.length), 0));
  const oldest = await query({ sort: "year-asc" });
  assert.equal(oldest.results[0].year, records.reduce((min, r) => r.year === null ? min : Math.min(min, r.year), Infinity));
  const newest = await query({ sort: "year-desc" });
  assert.equal(newest.results[0].year, records.reduce((max, r) => r.year === null ? max : Math.max(max, r.year), -Infinity));
  console.table(timings);
  console.log("Full-dataset search checks passed.");
} finally {
  await worker.terminate();
}
