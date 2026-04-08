const SETTINGS_KEY = "settings";
const SESSION_KEY = "session";
const GEMINI_MODEL = "gemini-2.5-flash";

const DEFAULT_SETTINGS = {
  apiKey: ""
};

const DEFAULT_SESSION = {
  status: "idle",
  startedAt: null,
  stoppedAt: null,
  requests: [],
  requestCount: 0,
  normalizedSummary: null,
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
    void recordRequest(details);
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
          sendResponse(await startRecording());
          break;
        case "stopRecordingAndGenerate":
          sendResponse(await stopRecordingAndGenerate());
          break;
        case "clearSession":
          sendResponse(await clearSession());
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
      apiKeyConfigured: Boolean(settings.apiKey)
    },
    session
  };
}

async function saveSettings(payload) {
  const nextSettings = {
    apiKey: String(payload?.apiKey || "").trim()
  };

  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
  return buildState();
}

async function startRecording() {
  const session = await setSession({
    ...DEFAULT_SESSION,
    status: "recording",
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

  const normalizedSummary = normalizeRequests(session.requests);
  const analyzingSession = await setSession({
    ...session,
    status: "analyzing",
    stoppedAt: new Date().toISOString(),
    normalizedSummary,
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

    const results = await analyzeWithGemini(session.normalizedSummary, apiKey, async (progress) => {
      await updateAnalyzingSession(progress);
    });

    const latestSession = await getSession();
    if (latestSession.status !== "analyzing") {
      return;
    }

    await setSession({
      ...DEFAULT_SESSION,
      status: "results",
      startedAt: session.startedAt,
      stoppedAt: latestSession.stoppedAt,
      requestCount: latestSession.requestCount,
      normalizedSummary: latestSession.normalizedSummary,
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
  const session = await setSession({ ...DEFAULT_SESSION });
  return { ok: true, session };
}

async function recordRequest(details) {
  const session = await getSession();
  if (session.status !== "recording") {
    return;
  }

  const url = safeParseUrl(details.url);
  if (!url || url.protocol.startsWith("chrome")) {
    return;
  }

  const request = {
    url: details.url,
    hostname: url.hostname,
    path: url.pathname || "/",
    type: details.type || "other",
    method: details.method || "GET",
    timestamp: new Date().toISOString()
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

function normalizeRequests(requests) {
  const byHost = new Map();

  for (const request of requests) {
    const current = byHost.get(request.hostname) || {
      hostname: request.hostname,
      paths: new Set(),
      requestTypes: new Set(),
      contentTypes: new Set(),
      methods: new Set(),
      count: 0,
      firstSeenAt: request.timestamp,
      lastSeenAt: request.timestamp
    };

    current.count += 1;
    current.paths.add(request.path || "/");
    current.requestTypes.add(request.type || "other");
    current.contentTypes.add(mapRequestTypeToContentLabel(request.type));
    current.methods.add(request.method || "GET");
    current.lastSeenAt = request.timestamp;
    byHost.set(request.hostname, current);
  }

  const hosts = [...byHost.values()]
    .map((entry) => ({
      hostname: entry.hostname,
      count: entry.count,
      samplePaths: [...entry.paths].sort().slice(0, 10),
      requestTypes: [...entry.requestTypes].sort(),
      contentTypes: [...entry.contentTypes].sort(),
      methods: [...entry.methods].sort(),
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt
    }))
    .sort((left, right) => right.count - left.count || left.hostname.localeCompare(right.hostname));

  return {
    capturedRequestCount: requests.length,
    hostCount: hosts.length,
    hosts
  };
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

async function analyzeWithGemini(normalizedSummary, apiKey, onProgress) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: buildGeminiPrompt(normalizedSummary),
      stream: true,
      store: false,
      response_mime_type: "application/json",
      response_format: buildResponseSchema(),
      generation_config: {
        temperature: 0.1,
        thinking_level: "low",
        thinking_summaries: "auto"
      }
    })
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("The API key was rejected. Verify the key and try again.");
    }

    throw new Error(`AI generation failed with status ${response.status}.`);
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

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseEvent(chunk);
      if (event) {
        await handleStreamEvent(event, outputs, onProgress);
      }
      boundary = buffer.indexOf("\n\n");
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

  return parseResults(parsed, normalizedSummary);
}

async function handleStreamEvent(event, outputs, onProgress) {
  switch (event.event_type) {
    case "interaction.start":
      await onProgress({ analysisStage: "Sending to AI" });
      break;
    case "interaction.status_update":
      await onProgress({ analysisStage: "Waiting for AI response" });
      break;
    case "content.start":
      outputs.set(event.index, { type: event.content?.type || "text" });
      break;
    case "content.delta":
      await accumulateDelta(event, outputs, onProgress);
      break;
    case "error":
      throw new Error(event.error?.message || "AI stream failed.");
    default:
      break;
  }
}

async function accumulateDelta(event, outputs, onProgress) {
  const output = outputs.get(event.index) || { type: "text" };
  outputs.set(event.index, output);

  switch (event.delta?.type) {
    case "text":
      output.text = (output.text || "") + (event.delta.text || "");
      await onProgress({ analysisStage: "Generating Web Links" });
      break;
    case "thought_summary":
      output.summary = (output.summary || "") + (event.delta.content?.text || "");
      await onProgress({
        analysisStage: "Reviewing AI reasoning",
        latestReasoning: output.summary.trim() || null
      });
      break;
    case "thought":
      output.summary = (output.summary || "") + (event.delta.thought || "");
      await onProgress({
        analysisStage: "Reviewing AI reasoning",
        latestReasoning: output.summary.trim() || null
      });
      break;
    default:
      break;
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

function parseResults(parsed, normalizedSummary) {
  const hostIndex = buildHostIndex(normalizedSummary);
  const site = typeof parsed?.site === "string" ? parsed.site.trim() : "";
  if (!site) {
    throw new Error("AI did not include a valid Site value.");
  }

  const siteMatch = matchEntryToNormalizedHost(site, hostIndex);
  const siteRationale = normalizeRationale(parsed?.siteRationale, "the Site value", siteMatch);

  return {
    site,
    siteRequestCount: siteMatch.count,
    siteContentTypes: siteMatch.contentTypes,
    siteRationale,
    contentDependencies: normalizeDependencyBucket(parsed?.contentDependencies, "Content Dependencies", hostIndex),
    multimediaDependencies: normalizeDependencyBucket(parsed?.multimediaDependencies, "Multimedia Dependencies", hostIndex),
    socialMediaDependencies: normalizeDependencyBucket(parsed?.socialMediaDependencies, "Social Media Dependencies", hostIndex)
  };
}

function normalizeDependencyBucket(bucket, label, hostIndex) {
  if (!Array.isArray(bucket)) {
    throw new Error(`AI did not include a valid ${label} list.`);
  }

  return bucket.map((entry) => {
    const value = typeof entry?.value === "string" ? entry.value.trim() : "";
    if (!value) {
      throw new Error(`AI returned an entry without a value in ${label}.`);
    }

    const match = matchEntryToNormalizedHost(value, hostIndex);

    return {
      value,
      requestCount: match.count,
      contentTypes: match.contentTypes,
      rationale: normalizeRationale(entry?.rationale, `${label} entry ${value}`, match)
    };
  });
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
  return `${text} This matched ${requestLabel} in the recording and served ${contentTypes}.`;
}

function buildHostIndex(normalizedSummary) {
  return new Map((normalizedSummary?.hosts || []).map((host) => [host.hostname.toLowerCase(), host]));
}

function matchEntryToNormalizedHost(value, hostIndex) {
  const normalized = value.toLowerCase().replace(/^https?:\/\//, "").replace(/^\*\./, "");
  const [hostPart] = normalized.split("/");
  const exact = hostIndex.get(hostPart);
  if (exact) {
    return {
      count: exact.count,
      contentTypes: exact.contentTypes || []
    };
  }

  const wildcardMatches = [...hostIndex.entries()]
    .filter(([hostname]) => hostname === hostPart || hostname.endsWith(`.${hostPart}`))
    .map(([, host]) => host);

  if (!wildcardMatches.length) {
    throw new Error(`AI returned ${value}, which did not match any recorded domain.`);
  }

  const contentTypes = [...new Set(wildcardMatches.flatMap((host) => host.contentTypes || []))].sort();
  const count = wildcardMatches.reduce((sum, host) => sum + host.count, 0);

  return { count, contentTypes };
}

function stripCodeFence(value) {
  return value.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}

function buildGeminiPrompt(normalizedSummary) {
  return [
    "You are helping generate a Securly Web Link allow list for a school district.",
    "Given a summary of browser requests captured during a teacher's guided session, decide:",
    "1. the best single Securly Site value for the target service",
    "2. which dependency domains or domain+path entries should also be allowlisted",
    "3. which best-fit category each dependency belongs in: content, multimedia, or social media",
    "",
    "Important rules:",
    "- Prefer the main instructional destination as the site value.",
    "- Include dependencies to ensure all recorded requests are allowed.",
    "- Place each dependency in exactly one best-fit bucket. Do not duplicate the same dependency across categories.",
    "- Content Dependencies are for core app/site, auth, dashboards, APIs, assets, documents, LMS resources, and general classroom web dependencies.",
    "- Multimedia Dependencies are for substantively media-oriented services such as video, audio, or streaming platforms.",
    "- Social Media Dependencies are for social networks, social embeds, sharing widgets, or social feeds.",
    "- Decide when a dependency should use a wildcard such as *.example.com versus a fully qualified host such as abc123.cloudfront.net.",
    "- Prefer wildcard subdomains for well-known first-party education platforms when that better reflects the service's normal multi-subdomain structure.",
    "- Use path-specific entries only when path specificity is meaningfully safer or more precise than a whole-domain entry.",
    "- Return concise, user-readable rationale that can be shown directly in a popup.",
    "- For the site and every dependency, explain all three of these fields: why, domainScope, pathScope.",
    "- In why, explain why the entry is included and mention what kinds of content were observed from that domain in the recording summary.",
    "- In domainScope, explain why the domain is exact, wildcarded, or broader.",
    "- In pathScope, explain why the path is absent, exact, or broader.",
    "- Do not merge these categories together and do not leave any of them blank.",
    "- Return JSON only.",
    "",
    "Captured request summary:",
    JSON.stringify(normalizedSummary, null, 2)
  ].join("\n");
}

function buildResponseSchema() {
  return {
    type: "object",
    properties: {
      site: {
        type: "string",
        description: "The main Securly Site value."
      },
      siteRationale: rationaleSchema("Rationale for the main Site value."),
      contentDependencies: dependencyBucketSchema("Dependencies for core site functionality, assets, auth, APIs, documents, and general classroom web content."),
      multimediaDependencies: dependencyBucketSchema("Dependencies for video, audio, streaming, or otherwise media-focused platforms."),
      socialMediaDependencies: dependencyBucketSchema("Dependencies for social networks, social embeds, and social media widgets or feeds.")
    },
    required: ["site", "siteRationale", "contentDependencies", "multimediaDependencies", "socialMediaDependencies"]
  };
}

function dependencyBucketSchema(description) {
  return {
    type: "array",
    description,
    items: {
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "A dependency domain or domain+path entry."
        },
        rationale: rationaleSchema("Why this dependency is included and scoped as returned.")
      },
      required: ["value", "rationale"]
    }
  };
}

function rationaleSchema(description) {
  return {
    type: "object",
    description,
    properties: {
      why: {
        type: "string",
        description: "Why this entry is included in the Web Links output, including observed content loaded from the domain."
      },
      domainScope: {
        type: "string",
        description: "Why the domain is exact, wildcarded, or otherwise scoped this way."
      },
      pathScope: {
        type: "string",
        description: "Why the path is absent, exact, or otherwise scoped this way."
      }
    },
    required: ["why", "domainScope", "pathScope"]
  };
}
