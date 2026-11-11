const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");
const suffixList = fs.readFileSync(path.join(__dirname, "../src/public_suffix_list.dat"), "utf8");
const rationale = { why: "Required for the lesson.", domainScope: "Observed host.", pathScope: "Selected scope." };
const modelResult = {
  site: { domain: "learn.district.example" },
  siteRationale: rationale,
  dependencies: [
    { domain: "login.district.example", path: "", rationale },
    { domain: "*.labs.vendor.example", path: "", rationale }
  ]
};
const traffic = [
  ["https://learn.district.example/lessons/erosion", "main_frame"],
  ["https://login.district.example/authorize?state=private", "main_frame"],
  ["https://learn.district.example/oauth/callback?code=private#private", "main_frame"],
  ["https://learn.district.example/lessons/erosion", "main_frame"],
  ["https://launch.labs.vendor.example/erosion", "main_frame"],
  ["https://run.labs.vendor.example/sim/erosion", "main_frame"],
  ["https://assets.vendor.example/player.js", "script"]
];

function setup(mode, result = modelResult) {
  const calls = [];
  const observed = {};
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const storage = (data) => ({
    async get(keys) {
      return Object.fromEntries(keys.map((key) => [key, structuredClone(data[key])]));
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
      if (["results", "error"].includes(data.session?.status)) finish(data.session);
    }
  });
  const event = (name) => ({ addListener(callback) { observed[name] = callback; } });
  const context = vm.createContext({
    URL, TextDecoder, console,
    chrome: {
      runtime: {
        onInstalled: event("install"), onStartup: event("startup"), onMessage: event("message"),
        getURL: (file) => file
      },
      webRequest: { onBeforeRequest: event("request") },
      storage: { local: storage({ settings: { apiKey: "test-key", recordingMode: mode } }), session: storage({}) }
    },
    async fetch(url, options) {
      if (url === "src/public_suffix_list.dat") return new Response(suffixList);
      calls.push(JSON.parse(options.body));
      const event = (data) => `data: ${JSON.stringify(data)}\r\n\r\n`;
      return new Response(
        event({ event_type: "step.start", index: 0, step: { type: "model_output" } }) +
        event({ event_type: "step.delta", index: 0, delta: { type: "text", text: JSON.stringify(result) } })
      );
    }
  });
  vm.runInContext(source, context);
  const send = (type) => new Promise((resolve) => observed.message({ type }, {}, resolve));
  async function record(entries) {
    assert.equal((await send("startRecording")).ok, true);
    for (const [url, type] of entries) observed.request({ url, type });
    await send("stopRecordingAndGenerate");
    return finished;
  }
  return { calls, record };
}

for (const mode of ["all", "navigation"]) {
  test(`one constrained Gemini call for ${mode} mode`, { timeout: 3000 }, async () => {
    const { calls, record } = setup(mode);
    const session = await record(traffic);
    assert.equal(session.status, "results", session.error);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "gemini-3.8-flash");
    assert.equal(calls[0].store, false);
    const urls = JSON.parse(calls[0].input[1].text);
    const expected = mode === "all" ? traffic : traffic.filter(([, type]) => type === "main_frame");
    assert.deepEqual(urls, expected.map(([url]) => url.split(/[?#]/)[0]));
    assert.ok(urls.includes("https://learn.district.example/lessons/erosion"));
    const fields = calls[0].response_format.schema.properties;
    const site = fields.site;
    assert.deepEqual(site.properties.domain.enum, [
      "learn.district.example",
      "login.district.example",
      "launch.labs.vendor.example",
      "run.labs.vendor.example"
    ]);
    assert.equal("path" in site.properties, false);
    assert.deepEqual(site.required, ["domain"]);
    const dep = fields.dependencies.items.properties;
    assert.deepEqual(dep.path.enum, [""]);
    assert.ok(dep.domain.enum.includes("*.labs.vendor.example"));
    assert.ok(!dep.domain.enum.includes("assets.vendor.example"));
    assert.ok(dep.domain.enum.includes("learn.district.example"));
    assert.equal(session.results.siteRequestCount, 3);
    assert.deepEqual(session.results.dependencies.map(({ value }) => value),
      ["login.district.example", "*.labs.vendor.example"]);
  });
}

test("rejects an unknown Site domain", { timeout: 3000 }, async () => {
  const { record } = setup("navigation", {
    ...modelResult,
    site: { domain: "unknown.example" }
  });
  assert.match((await record(traffic)).error, /outside the recorded choices/);
});

test("rejects an unverified dependency path", { timeout: 3000 }, async () => {
  const { record } = setup("navigation", {
    ...modelResult,
    dependencies: [{ domain: "login.district.example", path: "/authorize", rationale }]
  });
  assert.match((await record(traffic)).error, /outside the allowed domain and path choices/);
});

test("an Access Plan covers all paths on the Site host without adding a dependency", { timeout: 3000 }, async () => {
  const { record } = setup("navigation", {
    ...modelResult,
    dependencies: [
      { domain: "learn.district.example", path: "", rationale },
      { domain: "learn.district.example", path: "", rationale }
    ]
  });
  const session = await record(traffic);
  assert.equal(session.status, "results", session.error);
  assert.equal(session.results.site, "https://learn.district.example");
  assert.equal(session.results.siteRequestCount, 3);
  assert.deepEqual(session.results.dependencies, []);
});

test("two Khan Academy pages on one host produce an empty dependency list", { timeout: 3000 }, async () => {
  const { calls, record } = setup("navigation", {
    site: { domain: "khanacademy.com" },
    siteRationale: rationale,
    dependencies: [{ domain: "khanacademy.com", path: "", rationale }]
  });
  const session = await record([
    ["https://khanacademy.com/math", "main_frame"],
    ["https://khanacademy.com/science", "main_frame"]
  ]);
  assert.equal(session.status, "results", session.error);
  const dependency = calls[0].response_format.schema.properties.dependencies.items;
  assert.deepEqual(dependency.properties.domain.enum, ["khanacademy.com"]);
  assert.deepEqual(dependency.properties.path.enum, [""]);
  assert.deepEqual(session.results.dependencies, []);
  assert.equal(session.results.siteRequestCount, 2);
});

test("a root Site covers subdomains but a specific subdomain leaves sibling dependencies", { timeout: 3000 }, async () => {
  const entries = [
    ["https://school.example/lesson", "main_frame"],
    ["https://learn.school.example/lesson", "main_frame"],
    ["https://quiz.school.example/start", "main_frame"]
  ];
  for (const domain of ["school.example", "learn.school.example"]) {
    const { record } = setup("navigation", {
      ...modelResult,
      site: { domain },
      dependencies: [{ domain: "quiz.school.example", path: "", rationale }]
    });
    const session = await record(entries);
    assert.equal(session.status, "results", session.error);
    const isRoot = domain === "school.example";
    assert.equal(session.results.siteRequestCount, isRoot ? 3 : 1);
    assert.deepEqual(session.results.dependencies.map(({ value }) => value),
      isRoot ? [] : ["quiz.school.example"]);
  }
});

test("does not offer a wildcard across private suffix tenants", { timeout: 3000 }, async () => {
  const { calls, record } = setup("all");
  await record([...traffic, ["https://one.github.io/", "main_frame"], ["https://two.github.io./", "main_frame"]]);
  const domains = calls[0].response_format.schema.properties.dependencies.items.properties.domain.enum;
  assert.ok(!domains.includes("*.github.io"));
  assert.ok(!domains.includes("*.io"));
});

test("reports a missing top-level page before calling Gemini", { timeout: 3000 }, async () => {
  const { calls, record } = setup("all");
  const session = await record([["https://assets.vendor.example/player.js", "script"]]);
  assert.match(session.error, /No top-level pages were captured/);
  assert.equal(calls.length, 0);
});
