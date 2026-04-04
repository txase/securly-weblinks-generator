const statusBadge = document.querySelector("#statusBadge");
const statusMessage = document.querySelector("#statusMessage");
const requestCount = document.querySelector("#requestCount");
const apiKeyStatus = document.querySelector("#apiKeyStatus");
const apiKeyInput = document.querySelector("#apiKeyInput");
const siteOutput = document.querySelector("#siteOutput");
const dependenciesOutput = document.querySelector("#dependenciesOutput");
const rationaleBlock = document.querySelector("#rationaleBlock");
const rationaleOutput = document.querySelector("#rationaleOutput");
const errorCard = document.querySelector("#errorCard");
const errorMessage = document.querySelector("#errorMessage");

const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const analyzeButton = document.querySelector("#analyzeButton");
const clearButton = document.querySelector("#clearButton");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const copySiteButton = document.querySelector("#copySiteButton");
const copyDependenciesButton = document.querySelector("#copyDependenciesButton");

startButton.addEventListener("click", () => void handleAction("startRecording"));
stopButton.addEventListener("click", () => void handleAction("stopRecording"));
analyzeButton.addEventListener("click", () => void handleAction("analyzeRecording"));
clearButton.addEventListener("click", () => void handleAction("clearSession"));
saveSettingsButton.addEventListener("click", () => void saveSettings());
copySiteButton.addEventListener("click", () => void copyValue(siteOutput.value, copySiteButton, "Copy Site"));
copyDependenciesButton.addEventListener("click", () =>
  void copyValue(dependenciesOutput.value, copyDependenciesButton, "Copy Dependencies")
);

void refresh();

async function refresh() {
  const state = await sendMessage({ type: "getState" });
  render(state);
}

async function handleAction(type) {
  setBusy(true);
  await sendMessage({ type });
  await refresh();
  setBusy(false);
}

async function saveSettings() {
  setBusy(true);
  await sendMessage({
    type: "saveSettings",
    payload: {
      apiKey: apiKeyInput.value
    }
  });
  await refresh();
  setBusy(false);
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

  statusBadge.textContent = toStatusLabel(session.status || "idle");
  statusBadge.className = `badge badge-${session.status || "idle"}`;
  statusMessage.textContent = buildStatusMessage(session, configured);
  requestCount.textContent = String(session.requestCount || 0);
  apiKeyStatus.textContent = configured ? "Configured" : "Missing";

  siteOutput.value = session.results?.site || "";
  dependenciesOutput.value = (session.results?.dependencies || []).join("\n");

  if (session.results?.rationale) {
    rationaleBlock.hidden = false;
    rationaleOutput.textContent = session.results.rationale;
  } else {
    rationaleBlock.hidden = true;
    rationaleOutput.textContent = "";
  }

  const error = session.status === "error" ? session.error || state?.error || "Unknown error." : "";
  errorCard.hidden = !error;
  errorMessage.textContent = error;

  startButton.disabled = session.status === "recording" || session.status === "analyzing";
  stopButton.disabled = session.status !== "recording";
  analyzeButton.disabled =
    session.status === "recording" ||
    session.status === "analyzing" ||
    (session.status !== "ready" && !(session.requestCount > 0 && session.status === "error"));
  clearButton.disabled = session.status === "analyzing";
  copySiteButton.disabled = !session.results?.site;
  copyDependenciesButton.disabled = !(session.results?.dependencies || []).length;
}

function setBusy(busy) {
  for (const button of document.querySelectorAll("button")) {
    button.disabled = busy || button.disabled;
  }
}

function toStatusLabel(status) {
  switch (status) {
    case "recording":
      return "Recording";
    case "ready":
      return "Ready";
    case "analyzing":
      return "Analyzing";
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
      return "Recording is active. Walk through the target service flow, including sign-in and the specific pages students need.";
    case "ready":
      return "Recording has stopped. Review your request count, then send the captured flow to Gemini for analysis.";
    case "analyzing":
      return "Gemini is analyzing the captured domains and paths. Keep this popup open until results return.";
    case "results":
      return "Gemini proposed a primary Site value and dependency list. Copy these into the Securly dashboard.";
    case "error":
      return session.error || "The workflow hit an error. Adjust the session or settings, then try again.";
    default:
      return configured
        ? "Click Start Recording, then navigate only through the service flow you want to allow."
        : "Save a Gemini API key, then start a focused recording session for the service you want to allow.";
  }
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
