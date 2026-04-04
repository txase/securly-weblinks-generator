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
  error: null
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
        case "stopRecording":
          sendResponse(await stopRecording());
          break;
        case "analyzeRecording":
          sendResponse(await analyzeRecording());
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

async function stopRecording() {
  const session = await getSession();

  if (session.status !== "recording") {
    return { ok: false, error: "No recording is currently in progress." };
  }

  if (!session.requests.length) {
    const nextSession = await setSession({
      ...session,
      status: "error",
      stoppedAt: new Date().toISOString(),
      error: "No useful requests were captured. Start recording and walk through the target flow again."
    });
    return { ok: false, session: nextSession, error: nextSession.error };
  }

  const nextSession = await setSession({
    ...session,
    status: "ready",
    stoppedAt: new Date().toISOString(),
    error: null
  });

  return { ok: true, session: nextSession };
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

async function analyzeRecording() {
  const settings = await getSettings();
  const session = await getSession();

  if (!settings.apiKey) {
    const nextSession = await setSession({
      ...session,
      status: "error",
      error: "A Gemini API key is required before analysis can run."
    });
    return { ok: false, session: nextSession, error: nextSession.error };
  }

  if (!session.requests.length) {
    const nextSession = await setSession({
      ...session,
      status: "error",
      error: "There is no recorded traffic to analyze."
    });
    return { ok: false, session: nextSession, error: nextSession.error };
  }

  const analyzingSession = await setSession({
    ...session,
    status: "analyzing",
    error: null
  });

  try {
    const normalizedSummary = normalizeRequests(analyzingSession.requests);
    const results = await analyzeWithGemini(normalizedSummary, settings.apiKey);

    const nextSession = await setSession({
      ...DEFAULT_SESSION,
      status: "results",
      startedAt: analyzingSession.startedAt,
      stoppedAt: analyzingSession.stoppedAt || new Date().toISOString(),
      requestCount: analyzingSession.requestCount,
      normalizedSummary,
      results
    });

    return { ok: true, session: nextSession };
  } catch (error) {
    const nextSession = await setSession({
      ...analyzingSession,
      status: "error",
      error: error instanceof Error ? error.message : "Gemini analysis failed."
    });
    return { ok: false, session: nextSession, error: nextSession.error };
  }
}

function normalizeRequests(requests) {
  const byHost = new Map();

  for (const request of requests) {
    const current = byHost.get(request.hostname) || {
      hostname: request.hostname,
      paths: new Set(),
      requestTypes: new Set(),
      methods: new Set(),
      count: 0,
      firstSeenAt: request.timestamp,
      lastSeenAt: request.timestamp
    };

    current.count += 1;
    current.paths.add(request.path || "/");
    current.requestTypes.add(request.type || "other");
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

async function analyzeWithGemini(normalizedSummary, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildGeminiPrompt(normalizedSummary)
              }
            ]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Gemini rejected the API key. Verify the key and try again.");
    }

    throw new Error(`Gemini request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch (_error) {
    throw new Error("Gemini returned malformed JSON.");
  }

  if (typeof parsed?.site !== "string" || !parsed.site.trim()) {
    throw new Error("Gemini response did not include a valid site value.");
  }

  if (!Array.isArray(parsed?.dependencies) || parsed.dependencies.some((value) => typeof value !== "string")) {
    throw new Error("Gemini response did not include a valid dependencies list.");
  }

  return {
    site: parsed.site.trim(),
    dependencies: parsed.dependencies.map((value) => value.trim()).filter(Boolean),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : ""
  };
}

function stripCodeFence(value) {
  return value.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}

function buildGeminiPrompt(normalizedSummary) {
  return [
    "You are helping generate a Securly Web Link allow list for a school district.",
    "Given a summary of browser requests captured during a teacher's guided session, decide:",
    "1. the best single Securly Site value for the target service",
    "2. the dependency domains or domain+path entries that should also be allowlisted",
    "",
    "Important rules:",
    "- Prefer the main instructional destination as the site value.",
    "- Include dependencies needed for dashboard launch, authentication redirects, app loading, and core in-app functionality.",
    "- Decide when a dependency should use a wildcard such as *.example.com versus a fully qualified host such as abc123.cloudfront.net.",
    "- Use path-specific entries only when path specificity is meaningfully safer or more precise than a whole-domain entry.",
    "- Exclude likely incidental noise when it is not required for the target service flow.",
    "- Return JSON only with keys: site, dependencies, rationale.",
    "- dependencies must be an array of strings.",
    "",
    "Captured request summary:",
    JSON.stringify(normalizedSummary, null, 2)
  ].join("\n");
}
