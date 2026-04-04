const statusBadge = document.querySelector("#statusBadge");
const statusMessage = document.querySelector("#statusMessage");
const requestCount = document.querySelector("#requestCount");
const apiKeyPrompt = document.querySelector("#apiKeyPrompt");
const settingsAnchor = document.querySelector("#settingsAnchor");
const recordingHint = document.querySelector("#recordingHint");
const analysisPanel = document.querySelector("#analysisPanel");
const analysisStage = document.querySelector("#analysisStage");
const reasoningPanel = document.querySelector("#reasoningPanel");
const latestReasoning = document.querySelector("#latestReasoning");
const settingsSection = document.querySelector("#settingsSection");
const apiKeyInput = document.querySelector("#apiKeyInput");
const siteOutput = document.querySelector("#siteOutput");
const dependenciesOutput = document.querySelector("#dependenciesOutput");
const rationaleBlock = document.querySelector("#rationaleBlock");
const rationaleOutput = document.querySelector("#rationaleOutput");
const errorCard = document.querySelector("#errorCard");
const errorMessage = document.querySelector("#errorMessage");
const actions = document.querySelector(".actions");

const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const cancelButton = document.querySelector("#cancelButton");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const copySiteButton = document.querySelector("#copySiteButton");
const copyDependenciesButton = document.querySelector("#copyDependenciesButton");

let isBusy = false;
let pollTimer = null;
let settingsInitialized = false;
let settingsUserToggled = false;
let suppressSettingsToggle = false;

startButton.addEventListener("click", () => void handleAction("startRecording"));
stopButton.addEventListener("click", () => void handleAction("stopRecordingAndGenerate"));
cancelButton.addEventListener("click", () => void handleAction("clearSession"));
saveSettingsButton.addEventListener("click", () => void saveSettings());
copySiteButton.addEventListener("click", () => void copyValue(siteOutput.value, copySiteButton, "Copy Site"));
copyDependenciesButton.addEventListener("click", () =>
  void copyValue(dependenciesOutput.value, copyDependenciesButton, "Copy Dependencies")
);
settingsAnchor.addEventListener("click", (event) => {
  event.preventDefault();
  openSettings();
});
settingsSection.addEventListener("toggle", () => {
  if (!suppressSettingsToggle) {
    settingsUserToggled = true;
  }
});

window.addEventListener("beforeunload", () => {
  stopPolling();
});

void refresh();

async function refresh() {
  const state = await sendMessage({ type: "getState" });
  render(state);
}

async function handleAction(type) {
  setBusy(true);
  await sendMessage({ type });
  setBusy(false);
  await refresh();
}

async function saveSettings() {
  setBusy(true);
  await sendMessage({
    type: "saveSettings",
    payload: {
      apiKey: apiKeyInput.value
    }
  });
  apiKeyInput.value = "";
  setBusy(false);
  await refresh();
}

async function copyValue(value, button, label) {
  if (!value) {
    return;
  }

  await navigator.clipboard.writeText(value);
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = label;
  }, 1200);
}

function render(state) {
  const session = state?.session || {};
  const configured = Boolean(state?.settings?.apiKeyConfigured);
  const status = session.status || "idle";
  const isRecording = status === "recording";
  const isAnalyzing = status === "analyzing";

  statusBadge.textContent = toStatusLabel(status);
  statusBadge.className = `badge badge-${status}`;
  statusMessage.textContent = buildStatusMessage(session, configured);
  requestCount.textContent = String(session.requestCount || 0);

  apiKeyPrompt.hidden = configured;
  const hint = configured ? buildRecordingHint(status) : "";
  recordingHint.hidden = !hint || isAnalyzing;
  recordingHint.textContent = hint;

  analysisPanel.hidden = !isAnalyzing;
  analysisStage.textContent = session.analysisStage || "Preparing recording";
  latestReasoning.textContent = session.latestReasoning || "";
  reasoningPanel.hidden = !session.latestReasoning;

  siteOutput.value = session.results?.site || "";
  dependenciesOutput.value = (session.results?.dependencies || []).map((entry) => entry.value).join("\n");
  renderRationale(session.results);

  const error = status === "error" ? session.error || state?.error || "Unknown error." : "";
  errorCard.hidden = !error;
  errorMessage.textContent = error;

  actions.classList.toggle("single-action", !isRecording);
  startButton.hidden = isRecording;
  stopButton.hidden = !isRecording;
  cancelButton.hidden = !isRecording;

  startButton.disabled = isBusy || !configured || isAnalyzing;
  stopButton.disabled = isBusy || !isRecording;
  cancelButton.disabled = isBusy || !isRecording;
  saveSettingsButton.disabled = isBusy;
  copySiteButton.disabled = isBusy || !session.results?.site;
  copyDependenciesButton.disabled = isBusy || !(session.results?.dependencies || []).length;

  syncSettingsState(configured);
  updatePolling(isAnalyzing);
}

function renderRationale(results) {
  rationaleOutput.textContent = "";

  const items = [];
  if (results?.site && isStructuredRationale(results.siteRationale)) {
    items.push({
      label: `Site: ${results.site}`,
      rationale: results.siteRationale
    });
  }

  for (const dependency of results?.dependencies || []) {
    if (dependency?.value && isStructuredRationale(dependency?.rationale)) {
      items.push({
        label: dependency.value,
        rationale: dependency.rationale
      });
    }
  }

  rationaleBlock.hidden = items.length === 0;

  for (const item of items) {
    rationaleOutput.appendChild(buildRationaleItem(item.label, item.rationale));
  }
}

function buildRationaleItem(label, rationale) {
  const listItem = document.createElement("li");

  const heading = document.createElement("strong");
  heading.textContent = label;
  listItem.appendChild(heading);

  const subList = document.createElement("ul");
  subList.className = "rationale-sublist";

  subList.appendChild(buildRationaleDetail("Why", rationale.why));
  subList.appendChild(buildRationaleDetail("Domain Scope", rationale.domainScope));
  subList.appendChild(buildRationaleDetail("Path Scope", rationale.pathScope));

  listItem.appendChild(subList);
  return listItem;
}

function buildRationaleDetail(label, value) {
  const detail = document.createElement("li");
  detail.className = "rationale-detail";
  detail.innerHTML = `<strong>${label}:</strong> ${escapeHtml(value)}`;
  return detail;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isStructuredRationale(value) {
  return (
    value &&
    typeof value.why === "string" &&
    typeof value.domainScope === "string" &&
    typeof value.pathScope === "string"
  );
}

function syncSettingsState(configured) {
  if (settingsInitialized && settingsUserToggled) {
    return;
  }

  suppressSettingsToggle = true;
  settingsSection.open = !configured;
  suppressSettingsToggle = false;
  settingsInitialized = true;
}

function openSettings() {
  suppressSettingsToggle = true;
  settingsSection.open = true;
  suppressSettingsToggle = false;
  settingsUserToggled = true;
  settingsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  apiKeyInput.focus();
}

function updatePolling(isAnalyzing) {
  if (isAnalyzing && !pollTimer) {
    pollTimer = window.setInterval(() => {
      void refresh();
    }, 700);
    return;
  }

  if (!isAnalyzing) {
    stopPolling();
  }
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function setBusy(busy) {
  isBusy = busy;
}

function toStatusLabel(status) {
  switch (status) {
    case "recording":
      return "Recording";
    case "analyzing":
      return "Generating";
    case "results":
      return "Results";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

function buildStatusMessage(session, configured) {
  switch (session.status) {
    case "recording":
      return "Recording is active. Walk through the lesson flow exactly as students should experience it, including sign-in and inline resources.";
    case "analyzing":
      return "AI is reviewing the captured traffic and generating a proposed Site value and dependency list.";
    case "results":
      return "Your Web Links are ready to review. Copy the Site and Dependencies into the Securly dashboard.";
    case "error":
      return session.error || "The workflow hit an error. Adjust the recording or settings, then try again.";
    default:
      return configured
        ? "Start a new recording, complete the learning flow, and the extension will generate Web Links when you stop."
        : "Add an API key in Settings to unlock recording, then capture the lesson flow you want to allow.";
  }
}

function buildRecordingHint(status) {
  if (status === "analyzing") {
    return "";
  }

  if (status === "results") {
    return "Use the copy buttons below to paste the proposed values into Securly.";
  }

  if (status === "error") {
    return "If you need to update your key or try a new recording, use Settings below or start again.";
  }

  return "";
}

async function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          session: {
            status: "error",
            requestCount: 0,
            results: null,
            error: chrome.runtime.lastError.message
          },
          settings: {
            apiKeyConfigured: false
          }
        });
        return;
      }

      resolve(response || { ok: false, error: "No response from extension." });
    });
  });
}
