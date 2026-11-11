const SETTINGS_KEY = "settings";
const SESSION_KEY = "session";
const GEMINI_MODEL = "gemini-3.8-flash";
const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
let recordingQueue = Promise.resolve();

const DEFAULT_SETTINGS = {
  apiKey: "",
  recordingMode: "all"
};

const DEFAULT_SESSION = {
  status: "idle",
  recordingMode: "all",
  startedAt: null,
  stoppedAt: null,
  requests: [],
  requestCount: 0,
  results: null,
  error: null,
  analysisStage: null,
  latestReasoning: null
};

chrome.runtime.onInstalled.addListener(() => {
  void initializeStorage();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeStorage();
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    void queueRecordingAction(() => recordRequest(details)).catch(console.error);
  },
  { urls: ["<all_urls>"] }
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message?.type) {
        case "getState":
          sendResponse(await buildState());
          break;
        case "saveSettings":
          sendResponse(await saveSettings(message.payload));
          break;
        case "startRecording":
          sendResponse(await queueRecordingAction(startRecording));
          break;
        case "stopRecordingAndGenerate":
          sendResponse(await queueRecordingAction(stopRecordingAndGenerate));
          break;
        case "clearSession":
          sendResponse(await queueRecordingAction(clearSession));
          break;
        default:
          sendResponse({ ok: false, error: "Unknown message type." });
      }
    } catch (error) {
      console.error(error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected extension error."
      });
    }
  })();

  return true;
});

function queueRecordingAction(action) {
  const result = recordingQueue.then(action);
  recordingQueue = result.catch(() => {});
  return result;
}

async function initializeStorage() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY]);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }

  await chrome.storage.session.set({ [SESSION_KEY]: DEFAULT_SESSION });
}

async function getSettings() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY]);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

async function getSession() {
  const stored = await chrome.storage.session.get([SESSION_KEY]);
  return { ...DEFAULT_SESSION, ...(stored[SESSION_KEY] || {}) };
}

async function setSession(session) {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
  return session;
}

async function updateAnalyzingSession(patch) {
  const session = await getSession();
  if (session.status !== "analyzing") {
    return session;
  }

  const nextSession = {
    ...session,
    ...patch
  };

  await chrome.storage.session.set({ [SESSION_KEY]: nextSession });
  return nextSession;
}

async function buildState() {
  const [settings, session] = await Promise.all([getSettings(), getSession()]);
  return {
    ok: true,
    settings: {
      apiKeyConfigured: Boolean(settings.apiKey),
      recordingMode: settings.recordingMode
    },
    session
  };
}

async function saveSettings(payload) {
  const nextSettings = await getSettings();
  if (typeof payload?.apiKey === "string") {
    nextSettings.apiKey = payload.apiKey.trim();
  }
  if (payload?.recordingMode === "all" || payload?.recordingMode === "navigation") {
    nextSettings.recordingMode = payload.recordingMode;
  }

  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
  return buildState();
}

async function startRecording() {
  if ((await getSession()).status === "analyzing") {
    return { ok: false, error: "Wait for the current analysis to finish." };
  }
  const { recordingMode } = await getSettings();
  const session = await setSession({
    ...DEFAULT_SESSION,
    status: "recording",
    recordingMode,
    startedAt: new Date().toISOString()
  });

  return { ok: true, session };
}

async function stopRecordingAndGenerate() {
  const settings = await getSettings();
  const session = await getSession();

  if (session.status !== "recording") {
    return { ok: false, error: "No recording is currently in progress." };
  }

  if (!settings.apiKey) {
    const nextSession = await setSession({
      ...session,
      status: "error",
      error: "An API key is required before AI generation can run."
    });
    return { ok: false, session: nextSession, error: nextSession.error };
  }

  if (!session.requests.length) {
    const nextSession = await setSession({
      ...session,
      status: "error",
      stoppedAt: new Date().toISOString(),
      error: "No useful requests were captured. Start a new recording and walk through the lesson flow again."
    });
    return { ok: false, session: nextSession, error: nextSession.error };
  }

  const analyzingSession = await setSession({
    ...session,
    status: "analyzing",
    stoppedAt: new Date().toISOString(),
    error: null,
    analysisStage: "Preparing recording",
    latestReasoning: null
  });

  void runAnalysis(analyzingSession, settings.apiKey);

  return { ok: true, session: analyzingSession };
}

async function runAnalysis(session, apiKey) {
  try {
    await updateAnalyzingSession({ analysisStage: "Sending to AI" });

    const results = await analyzeWithGemini(session, apiKey, async (progress) => {
      await updateAnalyzingSession(progress);
    });

    const latestSession = await getSession();
    if (latestSession.status !== "analyzing") {
      return;
    }

    await setSession({
      ...DEFAULT_SESSION,
      status: "results",
      recordingMode: session.recordingMode,
      startedAt: session.startedAt,
      stoppedAt: latestSession.stoppedAt,
      requestCount: latestSession.requestCount,
      results
    });
  } catch (error) {
    const latestSession = await getSession();
    if (latestSession.status !== "analyzing") {
      return;
    }

    await setSession({
      ...latestSession,
      status: "error",
      error: error instanceof Error ? error.message : "AI generation failed.",
      analysisStage: null
    });
  }
}

async function clearSession() {
  if ((await getSession()).status === "analyzing") {
    return { ok: false, error: "Wait for the current analysis to finish." };
  }
  const session = await setSession({ ...DEFAULT_SESSION });
  return { ok: true, session };
}

async function recordRequest(details) {
  const session = await getSession();
  if (session.status !== "recording") {
    return;
  }

  if (session.recordingMode === "navigation" && details.type !== "main_frame") {
    return;
  }

  const url = parseNetworkUrl(details.url);
  if (!url) {
    return;
  }

  const request = {
    url: url.origin + url.pathname,
    type: details.type || "other"
  };

  const requests = [...session.requests, request];
  await setSession({
    ...session,
    requests,
    requestCount: requests.length
  });
}

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch (_error) {
    return null;
  }
}

function parseNetworkUrl(value) {
  const url = safeParseUrl(value);
  if (!url || !NETWORK_PROTOCOLS.has(url.protocol)) return null;
  if (url.hostname.endsWith(".")) url.hostname = url.hostname.slice(0, -1);
  return url;
}

function mapRequestTypeToContentLabel(requestType) {
  switch (requestType) {
    case "main_frame":
    case "sub_frame":
      return "document content";
    case "script":
      return "scripts";
    case "stylesheet":
      return "stylesheets";
    case "image":
      return "images";
    case "font":
      return "fonts";
    case "xmlhttprequest":
    case "fetch":
      return "API data";
    case "media":
      return "video or audio";
    case "object":
      return "embedded media";
    case "ping":
      return "tracking or beacon requests";
    default:
      return "other web resources";
  }
}

async function analyzeWithGemini(session, apiKey, onProgress) {
  const recording = await buildRuleCandidates(session.requests);
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "Api-Revision": "2026-05-20"
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: [
        { type: "text", text: buildGeminiInstructions(session.recordingMode) },
        { type: "text", text: JSON.stringify(recording.requests.map(({ url }) => url.origin + url.pathname)) }
      ],
      stream: true,
      store: false,
      response_format: buildResponseSchema(recording),
      generation_config: {
        thinking_level: "low",
        thinking_summaries: "auto"
      }
    })
  });

  if (!response.ok) {
    let details = "";
    try {
      const errorJson = await response.json();
      details = errorJson.error?.message || JSON.stringify(errorJson);
    } catch (_) {
      try {
        details = await response.text();
      } catch (_) {}
    }

    const suffix = details ? `: ${details}` : "";
    if (response.status === 401 || response.status === 403) {
      throw new Error(`The API key was rejected. Verify the key and try again${suffix}`);
    }

    throw new Error(`AI generation failed with status ${response.status}${suffix}`);
  }

  if (!response.body) {
    throw new Error("AI did not return a readable response stream.");
  }

  await onProgress({ analysisStage: "Waiting for AI response" });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const outputs = new Map();

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary = /\r?\n\r?\n/.exec(buffer);
    while (boundary) {
      const chunk = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const event = parseSseEvent(chunk);
      if (event) {
        await handleStreamEvent(event, outputs, onProgress);
      }
      boundary = /\r?\n\r?\n/.exec(buffer);
    }

    if (done) {
      if (buffer.trim()) {
        const event = parseSseEvent(buffer);
        if (event) {
          await handleStreamEvent(event, outputs, onProgress);
        }
      }
      break;
    }
  }

  await onProgress({ analysisStage: "Processing results" });

  const fullText = [...outputs.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, output]) => output.text || "")
    .join("")
    .trim();

  if (!fullText) {
    throw new Error("AI returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(fullText));
  } catch (_error) {
    throw new Error("AI returned malformed JSON.");
  }

  return parseResults(parsed, recording);
}

async function handleStreamEvent(event, outputs, onProgress) {
  const index = typeof event.index === "number" ? event.index : 0;
  switch (event.event_type) {
    case "interaction.start":
    case "interaction.created":
      await onProgress({ analysisStage: "Sending to AI" });
      break;
    case "interaction.status_update":
      await onProgress({ analysisStage: "Waiting for AI response" });
      break;
    case "content.start":
      outputs.set(index, { type: event.content?.type || "text" });
      break;
    case "step.start":
      outputs.set(index, { type: event.step?.type || "text" });
      break;
    case "content.delta":
    case "step.delta":
      await accumulateDelta(event, outputs, onProgress);
      break;
    case "error":
      throw new Error(event.error?.message || "AI stream failed.");
    default:
      break;
  }
}

async function accumulateDelta(event, outputs, onProgress) {
  const index = typeof event.index === "number" ? event.index : 0;
  const output = outputs.get(index) || { type: "text" };
  outputs.set(index, output);

  const text = event.delta?.text;
  const thought = event.delta?.thought || event.delta?.content?.text;

  if (text) {
    output.text = (output.text || "") + text;
    await onProgress({ analysisStage: "Generating Web Links" });
  }

  if (thought) {
    output.summary = (output.summary || "") + thought;
    await onProgress({
      analysisStage: "Reviewing AI reasoning",
      latestReasoning: output.summary.trim() || null
    });
  }
}

function parseSseEvent(chunk) {
  const dataLines = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (!dataLines.length) {
    return null;
  }

  try {
    return JSON.parse(dataLines.join("\n"));
  } catch (_error) {
    return null;
  }
}

async function buildRuleCandidates(capturedRequests) {
  const requests = capturedRequests
    .map(({ url, type }) => ({ url: parseNetworkUrl(url), type }))
    .filter(({ url }) => url);
  const siteHosts = new Map();
  const dependencyDomains = new Set();
  for (const { url, type } of requests) {
    if (type !== "main_frame" || !["http:", "https:"].includes(url.protocol)) continue;
    if (!siteHosts.has(url.host)) siteHosts.set(url.host, url);
    dependencyDomains.add(url.hostname);
  }

  if (!siteHosts.size) {
    throw new Error("No top-level pages were captured. Start a new recording and open the lesson in a browser tab.");
  }

  const response = await fetch(chrome.runtime.getURL("src/public_suffix_list.dat"));
  if (!response.ok) throw new Error("Could not load the domain rules for this extension.");
  const suffixes = parsePublicSuffixList(await response.text());
  const hostsByParent = new Map();
  for (const host of dependencyDomains) {
    // IP addresses and single-label hosts cannot supply wildcard candidates.
    if (!/[a-z]/.test(host) || host.includes(":")) continue;
    for (let dot = host.indexOf("."); dot !== -1; dot = host.indexOf(".", dot + 1)) {
      const parent = host.slice(dot + 1);
      if (isPublicSuffix(parent, suffixes)) break;
      hostsByParent.set(parent, (hostsByParent.get(parent) || 0) + 1);
    }
  }
  for (const [parent, count] of hostsByParent) {
    if (count > 1) dependencyDomains.add(`*.${parent}`);
  }

  return { requests, siteHosts, dependencyDomains, suffixes };
}

function parsePublicSuffixList(text) {
  const suffixes = new Set();
  for (const line of text.split(/\r?\n/)) {
    const rule = line.trim();
    if (!rule || rule.startsWith("//")) continue;
    const prefix = rule.startsWith("*.") ? "*." : rule.startsWith("!") ? "!" : "";
    const domain = safeParseUrl(`https://${rule.slice(prefix.length)}`)?.hostname;
    if (domain) suffixes.add(prefix + domain);
  }
  return suffixes;
}

function isPublicSuffix(domain, suffixes) {
  const dot = domain.indexOf(".");
  return !suffixes.has(`!${domain}`) &&
    (dot === -1 || suffixes.has(domain) || suffixes.has(`*.${domain.slice(dot + 1)}`));
}

function matchesDependency(host, rule) {
  return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) : host === rule;
}

function matchesSite(url, site, suffixes) {
  const host = site.hostname;
  const base = host.replace(/^www\./, "");
  const dot = base.indexOf(".");
  const isRoot = dot !== -1 && /[a-z]/.test(base) && !isPublicSuffix(base, suffixes) &&
    isPublicSuffix(base.slice(dot + 1), suffixes);
  return url.hostname === host ||
    (isRoot && (url.hostname === base || url.hostname.endsWith(`.${base}`)));
}

function parseResults(parsed, recording) {
  const { requests, siteHosts, dependencyDomains, suffixes } = recording;
  const site = siteHosts.get(parsed?.site?.domain);
  if (!site) {
    throw new Error("AI selected a Site domain outside the recorded choices.");
  }
  if (!Array.isArray(parsed.dependencies)) {
    throw new Error("AI did not include a valid Dependencies list.");
  }

  const siteCovers = (url) => matchesSite(url, site, suffixes);
  const siteMatch = summarizeMatches(requests, siteCovers);
  const dependencies = new Map();
  for (const entry of parsed.dependencies) {
    if (!dependencyDomains.has(entry?.domain) || entry.path !== "") {
      throw new Error("AI selected a dependency outside the allowed domain and path choices.");
    }
    if (matchesDependency(site.hostname, entry.domain)) continue;
    const covers = (url) => matchesDependency(url.hostname, entry.domain);
    const match = summarizeMatches(requests, covers);
    const rationale = normalizeRationale(entry.rationale, entry.domain, match);
    const addsCoverage = requests.some(({ url, type }) =>
      type === "main_frame" && covers(url) && !siteCovers(url)
    );
    if (addsCoverage && !dependencies.has(entry.domain)) {
      dependencies.set(entry.domain, { value: entry.domain, requestCount: match.count, rationale });
    }
  }

  return {
    site: site.origin,
    siteRequestCount: siteMatch.count,
    siteRationale: normalizeRationale(parsed.siteRationale, "the Site value", siteMatch),
    dependencies: [...dependencies.values()]
  };
}

function summarizeMatches(requests, matches) {
  const matched = requests.filter(({ url }) => matches(url));
  const contentTypes = [...new Set(matched.map(({ type }) => mapRequestTypeToContentLabel(type)))].sort();
  return { count: matched.length, contentTypes };
}

function normalizeRationale(value, label, match) {
  const why = typeof value?.why === "string" ? value.why.trim() : "";
  const domainScope = typeof value?.domainScope === "string" ? value.domainScope.trim() : "";
  const pathScope = typeof value?.pathScope === "string" ? value.pathScope.trim() : "";

  if (!why || !domainScope || !pathScope) {
    throw new Error(`AI returned incomplete rationale for ${label}.`);
  }

  return {
    why: appendObservedContext(why, match),
    domainScope,
    pathScope
  };
}

function appendObservedContext(text, match) {
  const contentTypes = match.contentTypes.length ? match.contentTypes.join(", ") : "other web resources";
  const requestLabel = match.count === 1 ? "1 matched request" : `${match.count} matched requests`;
  return `${text} This matched ${requestLabel} in the recording for ${contentTypes}.`;
}

function stripCodeFence(value) {
  return value.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}

function buildGeminiInstructions(recordingMode) {
  return [
    "You are helping generate a Securly Web Link for an Allow-list Access Plan.",
    "Given a JSON array of browser request URLs in capture order from a teacher's guided session, decide:",
    "1. the best single Securly Site value for the target service",
    "2. which dependency domains should also be allowlisted",
    "",
    "Important rules:",
    "- Prefer the main instructional destination as the site value.",
    "- Choose the main instructional Site host from the schema. Use recorded paths as context for that choice.",
    "- In an Allow-list Access Plan, the Site covers all paths on its host. A root domain or its www form also covers its subdomains.",
    "- Never include a dependency that matches the Site host.",
    "- Include dependencies for the required top-level destinations that the Site does not already allow. The schema limits candidates to top-level evidence.",
    ...(recordingMode === "navigation" ? [
      "- This recording contains only top-level page requests. Do not infer unobserved background or embedded resources."
    ] : []),
    "- Do not duplicate dependencies.",
    "- Decide when a dependency should use a wildcard such as *.example.com versus a fully qualified host such as abc123.cloudfront.net.",
    "- Prefer wildcard subdomains for well-known first-party education platforms when that better reflects the service's normal multi-subdomain structure.",
    "- A dependency path of an empty string means the entire host or wildcard scope.",
    "- Return concise, user-readable rationale that can be shown directly in a popup.",
    "- For the site and every dependency, explain all three of these fields: why, domainScope, pathScope.",
    "- In why, explain why the entry is included using the recorded URLs as evidence.",
    "- In domainScope, explain why the domain is exact, wildcarded, or broader.",
    "- In pathScope, explain why the rule covers all paths.",
    "- Do not merge the rationale fields or leave any of them blank.",
    "- Return JSON only."
  ].join("\n");
}

function buildResponseSchema({ siteHosts, dependencyDomains }) {
  return {
    type: "text",
    mime_type: "application/json",
    schema: requiredObject({
      site: requiredObject({ domain: stringEnum([...siteHosts.keys()]) }),
      dependencies: {
        type: "array",
        items: requiredObject({
          domain: stringEnum([...dependencyDomains]),
          path: stringEnum([""]),
          rationale: rationaleSchema("Why this dependency is included and scoped as returned.")
        })
      },
      siteRationale: rationaleSchema("Rationale for the main Site value.")
    })
  };
}

function requiredObject(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false
  };
}

function stringEnum(values) {
  return { type: "string", enum: values };
}

function rationaleSchema(description) {
  return {
    type: "object",
    description,
    properties: {
      why: {
        type: "string",
        description: "Why this entry is included in the Web Links output based on the observed URLs."
      },
      domainScope: {
        type: "string",
        description: "Why the domain is exact, wildcarded, or otherwise scoped this way."
      },
      pathScope: {
        type: "string",
        description: "Why this rule covers all paths."
      }
    },
    required: ["why", "domainScope", "pathScope"]
  };
}
