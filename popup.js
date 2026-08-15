/**
 * popup.js — Code Mentor AI Chrome Extension Frontend
 *
 * Communicates exclusively with the local backend (no direct Gemini calls).
 * Tracks hint history client-side and sends previousHints to the backend.
 */

const API_BASE_URL = "http://localhost:3001/api";

let DEVICE_ID = "";
let currentProblem = null;
let selectedLevel = 1;
let completedLevels = new Set();
// Client-side hint storage: previousHints[level] = "hint text"
let sessionHints = {};

// ── DOM Refs ──
const $ = (id) => document.getElementById(id);
const problemCard = $("problem-card");
const noProblem = $("no-problem");
const problemTitle = $("problem-title-text");
const problemDesc = $("problem-desc");
const problemPlatform = $("problem-platform");
const levelBadges = $("level-badges");
const actionBtns = $("action-btns");
const getHintBtn = $("get-hint-btn");
const nextHintBtn = $("next-hint-btn");
const similarBtn = $("similar-btn");
const loader = $("loader");
const loaderText = $("loader-text");
const outputBox = $("output-box");
const outputText = $("output-text");
const outputTag = $("output-tag");
const copyBtn = $("copy-btn");
const errorBox = $("error-box");
const errorTitle = $("error-title");
const errorMessage = $("error-message");
const similarEmpty = $("similar-empty");
const requestCounter = $("request-counter");
const statusDot = $("status-dot");
const apiKeyInput = $("api-key-input");
const saveKeyBtn = $("save-key-btn");
const keyStatus = $("key-status");
const deviceIdDisp = $("device-id-display");
const serverStatusIcon = $("server-status-icon");
const serverStatusText = $("server-status-text");
const historyContainer = $("history-container");
const historyEmpty = $("history-empty");

// ── Utilities ──
function showLoader(msg = "Thinking…") {
  if (loaderText) loaderText.textContent = msg;
  if (loader) loader.classList.add("visible");
  hideOutput();
  hideError();
  if (getHintBtn) getHintBtn.disabled = true;
  if (nextHintBtn) nextHintBtn.disabled = true;
  if (similarBtn) similarBtn.disabled = true;
}

function hideLoader() {
  if (loader) loader.classList.remove("visible");
  if (getHintBtn) getHintBtn.disabled = false;
  if (nextHintBtn) nextHintBtn.disabled = false;
  if (similarBtn) similarBtn.disabled = false;
}

function hideOutput() {
  if (outputBox) outputBox.classList.remove("visible");
}

function hideError() {
  if (errorBox) errorBox.style.display = "none";
}

function hideSimilarEmpty() {
  if (similarEmpty) similarEmpty.style.display = "none";
}

function showError(title, message) {
  hideLoader();
  hideOutput();
  if (errorTitle) errorTitle.textContent = title;
  if (errorMessage) errorMessage.textContent = message;
  if (errorBox) errorBox.style.display = "flex";
}

function updateRequestCounter(count) {
  if (requestCounter && count !== undefined) {
    requestCounter.textContent = `${count} AI requests today`;
    requestCounter.style.display = "block";
  }
}

function updateLevelBadges() {
  document.querySelectorAll(".level-badge").forEach((badge) => {
    const level = parseInt(badge.dataset.level);
    badge.classList.remove("active", "completed");
    if (completedLevels.has(level)) {
      badge.classList.add("completed");
    }
    if (level === selectedLevel) {
      badge.classList.add("active");
    }
  });
}

function renderMarkdown(text) {
  if (typeof marked !== "undefined") {
    return marked.parse(text);
  }
  return text.replace(/\n/g, "<br>");
}

function setOutput(html, tag) {
  hideError();
  hideSimilarEmpty();
  if (outputTag) outputTag.textContent = tag;
  if (outputText) outputText.innerHTML = html;
  if (outputBox) outputBox.classList.add("visible");
  hideLoader();
}

/**
 * Build previousHints array from sessionHints for levels < current.
 */
function getPreviousHints(currentLevel) {
  const hints = [];
  for (let i = 1; i < currentLevel; i++) {
    if (sessionHints[i]) {
      hints.push(sessionHints[i]);
    }
  }
  return hints;
}

// ── Storage Helpers ──
function getDeviceId() {
  return new Promise((resolve) => {
    chrome.storage.local.get("dsa_device_id", (data) => {
      if (data.dsa_device_id) {
        resolve(data.dsa_device_id);
      } else {
        const newId =
          "dev_" +
          Math.random().toString(36).substr(2, 9) +
          Date.now().toString(36);
        chrome.storage.local.set({ dsa_device_id: newId }, () =>
          resolve(newId)
        );
      }
    });
  });
}

function getStoredKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get("gemini_api_key", (data) => {
      resolve(data.gemini_api_key || null);
    });
  });
}

// ── Theme Toggle ──
(function () {
  const root = document.documentElement;
  const toggleBtn = $("theme-toggle");
  const knob = $("theme-knob");
  if (!toggleBtn) return;

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    if (knob) knob.textContent = theme === "light" ? "☀️" : "🌙";
    try {
      localStorage.setItem("cma-theme", theme);
    } catch (e) {}
  }

  let saved = "dark";
  try {
    saved = localStorage.getItem("cma-theme") || "dark";
  } catch (e) {}
  applyTheme(saved);

  toggleBtn.addEventListener("click", () => {
    const current = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(current);
  });
})();

// ── Tabs ──
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    const panel = $(`tab-${tab.dataset.tab}`);
    if (panel) panel.classList.add("active");
    if (tab.dataset.tab === "history") {
      fetchHistory();
    }
  });
});

// ── Save API Key ──
if (saveKeyBtn) {
  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput?.value.trim();
    if (!key) {
      if (keyStatus) keyStatus.textContent = "Enter a key first.";
      return;
    }
    chrome.storage.local.set({ gemini_api_key: key }, () => {
      if (keyStatus) {
        keyStatus.textContent = "✓ Key saved";
        keyStatus.className = "key-status ok";
      }
      if (apiKeyInput) apiKeyInput.value = "";
      setTimeout(() => {
        if (keyStatus) keyStatus.textContent = "Key stored ✓";
      }, 1500);
    });
  });
}

async function loadKeyStatus() {
  const key = await getStoredKey();
  if (!keyStatus) return;
  if (key) {
    keyStatus.textContent = `Key stored ✓ (${key.slice(0, 6)}…)`;
    keyStatus.className = "key-status ok";
  } else {
    keyStatus.textContent = "No key stored";
    keyStatus.className = "key-status";
  }
}

// ── Precomputation ──
async function precomputeHint(level) {
  if (!currentProblem) return;
  try {
    await fetch(`${API_BASE_URL}/hint`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": DEVICE_ID,
      },
      body: JSON.stringify({
        problem: currentProblem,
        level: level,
        previousHints: getPreviousHints(level),
        stream: false,
      }),
    });
  } catch (e) {
    // Ignore precompute errors silently
  }
}

// ── Server Health ──
async function checkServerHealth() {
  if (!serverStatusIcon || !serverStatusText) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      serverStatusIcon.textContent = "●";
      serverStatusText.textContent = "Connected · localhost:3001";
      serverStatusText.style.color = "var(--green)";
      return true;
    }
  } catch (e) {
    serverStatusIcon.textContent = "○";
    serverStatusText.textContent = "Backend offline — start server";
    serverStatusText.style.color = "var(--red)";
  }
  return false;
}

// ── Hint Streaming ──
async function getHints() {
  if (!currentProblem) return;

  const hasLocal = await checkServerHealth();
  if (!hasLocal) {
    showError(
      "Backend Offline",
      "Start the server with 'npm run dev' in server/ and try again."
    );
    return;
  }

  showLoader("Generating hint…");

  try {
    const response = await fetch(`${API_BASE_URL}/hint`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": DEVICE_ID,
      },
      body: JSON.stringify({
        problem: currentProblem,
        level: selectedLevel,
        previousHints: getPreviousHints(selectedLevel),
        stream: true,
      }),
    });

    // Check for non-SSE error responses
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok && !contentType.includes("text/event-stream")) {
      const errData = await response.json().catch(() => ({}));
      if (errData.error === "quota_exceeded") {
        showError(
          "AI Quota Reached",
          errData.message || "Try again later or check your API key quota."
        );
        return;
      }
      if (errData.error === "model_unavailable") {
        showError(
          "Model Unavailable",
          errData.message || "The AI model is not available."
        );
        return;
      }
      showError(
        "API Error",
        errData.error || `Server returned ${response.status}`
      );
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let done = false;
    let fullText = "";

    if (outputTag) outputTag.textContent = `HINT · LEVEL ${selectedLevel}`;
    if (outputText) outputText.innerHTML = "";
    if (outputBox) outputBox.classList.add("visible");
    hideLoader();
    hideError();
    hideSimilarEmpty();

    let buffer = "";

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        
        let newlineIdx;
        // SSE messages are separated by \n\n
        while ((newlineIdx = buffer.indexOf("\n\n")) >= 0) {
          const message = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 2);

          const lines = message.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (!dataStr || dataStr === "[DONE]") {
                done = true;
                break;
              }
              try {
                const parsed = JSON.parse(dataStr);

                if (parsed.error === "quota_exceeded") {
                  showError("AI Quota Reached", parsed.message || "Try again later.");
                  return;
                }
                if (parsed.error === "model_unavailable") {
                  showError("Model Unavailable", parsed.message || "Check server config.");
                  return;
                }
                if (parsed.error) {
                  showError("Generation Error", parsed.message || "Hint generation failed.");
                  return;
                }

                if (parsed.token) {
                  fullText += parsed.token;
                  if (outputText) {
                    outputText.innerHTML = renderMarkdown(fullText);
                    outputText.scrollTop = outputText.scrollHeight;
                  }
                }

                if (parsed.done) {
                  updateRequestCounter(parsed.requestCount);
                }
              } catch (e) {
                // Skip unparseable chunks
              }
            }
          }
        }
      }
    }

    // Store hint in client-side session
    sessionHints[selectedLevel] = fullText;

    // Mark level as completed and show Next button
    completedLevels.add(selectedLevel);
    updateLevelBadges();

    // Trigger background precomputation for the next level
    if (selectedLevel < 3) {
      precomputeHint(selectedLevel + 1);
    }

    if (getHintBtn) getHintBtn.style.display = "none";
    if (nextHintBtn) {
      if (selectedLevel < 3) {
        nextHintBtn.style.display = "flex";
        nextHintBtn.disabled = false;
        nextHintBtn.innerHTML = `Level ${selectedLevel + 1}`;
      } else {
        nextHintBtn.style.display = "none";
      }
    }
  } catch (err) {
    hideLoader();
    showError(
      "Connection Error",
      `Could not connect to backend: ${err.message}`
    );
  }
}

// ── Similar Problems ──
async function getSimilarProblems() {
  if (!currentProblem) return;

  hideSimilarEmpty();
  showLoader("Finding similar problems…");

  try {
    const res = await fetch(`${API_BASE_URL}/similar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": DEVICE_ID,
      },
      body: JSON.stringify({ problem: currentProblem }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.error === "quota_exceeded") {
        showError(
          "AI Quota Reached",
          errData.message || "Try again later."
        );
        return;
      }
      if (errData.error === "model_unavailable") {
        showError(
          "Model Unavailable",
          errData.message || "Check server config."
        );
        return;
      }
      showError(
        "API Error",
        errData.error || `Server returned ${res.status}`
      );
      return;
    }

    const data = await res.json();

    if (data.problems && data.problems.length > 0) {
      let html = "";

      // Show classification
      if (data.classification?.topics?.length) {
        html += `<div style="margin-bottom:8px;">`;
        html += `<span class="section-label" style="margin:0; display:inline;">Topics: </span>`;
        data.classification.topics.forEach((t) => {
          html += `<span class="sim-badge" style="margin-right:3px;">${t}</span>`;
        });
        html += `</div>`;
      }

      data.problems.forEach((p) => {
        let diffClass = "sim-badge";
        if (p.difficulty === "Easy") diffClass += " easy";
        else if (p.difficulty === "Medium") diffClass += " medium";
        else if (p.difficulty === "Hard") diffClass += " hard";

        html += `
          <div class="similar-item">
            <div class="similar-title">
              <a href="${p.url}" target="_blank">${p.title} ↗</a>
            </div>
            <div class="similar-meta">
              ${p.difficulty ? `<span class="${diffClass}">${p.difficulty}</span>` : ""}
              ${
                p.topicTags
                  ?.slice(0, 3)
                  .map((t) => `<span class="sim-badge">${t}</span>`)
                  .join("") || ""
              }
            </div>
          </div>
        `;
      });

      setOutput(html, "SIMILAR PROBLEMS");
    } else {
      setOutput(
        '<div class="empty-state">No similar problems found.</div>',
        "SIMILAR PROBLEMS"
      );
    }
  } catch (err) {
    showError(
      "Connection Error",
      `Could not fetch similar problems: ${err.message}`
    );
  }
}

// ── History ──
async function fetchHistory() {
  if (!historyContainer) return;
  historyContainer.innerHTML =
    '<tr><td colspan="4" style="text-align:center; padding:16px; color:var(--text-faint)">Loading…</td></tr>';
  if (historyEmpty) historyEmpty.style.display = "none";

  try {
    const res = await fetch(`${API_BASE_URL}/history?deviceId=${DEVICE_ID}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error("Failed to fetch");
    const data = await res.json();
    historyContainer.innerHTML = "";

    if (!data.history || data.history.length === 0) {
      if (historyEmpty) historyEmpty.style.display = "block";
      return;
    }

    data.history.forEach((item) => {
      const dateStr = new Date(item.createdAt).toLocaleDateString();
      const tr = document.createElement("tr");
      const probTitle = item.problem ? item.problem.title : "Unknown";
      const snippet =
        (item.content || "").replace(/#/g, "").slice(0, 120) + "…";
      tr.innerHTML = `
        <td class="history-date">${dateStr}</td>
        <td class="history-prob" title="${probTitle}">${probTitle}</td>
        <td><span class="history-lvl">L${item.level}</span></td>
        <td><div class="history-snippet">${snippet}</div></td>
      `;
      historyContainer.appendChild(tr);
    });
  } catch (e) {
    historyContainer.innerHTML = "";
    if (historyEmpty) historyEmpty.style.display = "block";
  }
}

// ── Problem Detection ──
async function detectProblem() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  const isLeetCode = url.includes("leetcode.com/problems/");
  const isCodeforces =
    url.includes("codeforces.com/problemset/") ||
    url.includes("codeforces.com/contest/") ||
    url.includes("codeforces.com/gym/");

  if (!isLeetCode && !isCodeforces) {
    if (noProblem) noProblem.style.display = "flex";
    if (problemCard) problemCard.classList.remove("visible");
    if (actionBtns) actionBtns.style.display = "none";
    if (levelBadges) levelBadges.style.display = "none";
    if (similarEmpty) similarEmpty.style.display = "none";
    return;
  }

  if (statusDot) {
    statusDot.classList.add("on-leetcode");
    statusDot.title = "Active on supported page";
  }

  try {
    const problem = await chrome.tabs.sendMessage(tab.id, {
      action: "getProblem",
    });
    if (problem?.title || problem?.description) {
      currentProblem = problem;
      currentProblem.platform = isLeetCode ? "leetcode" : "codeforces";
      currentProblem.url = url;

      // Reset session hints for new problem
      sessionHints = {};
      completedLevels.clear();
      selectedLevel = 1;

      if (noProblem) noProblem.style.display = "none";
      if (problemCard) problemCard.classList.add("visible");
      if (problemTitle)
        problemTitle.textContent = problem.title || "Untitled Problem";
      if (problemPlatform)
        problemPlatform.textContent = isLeetCode ? "LC" : "CF";
      if (problemDesc)
        problemDesc.textContent =
          (problem.description?.slice(0, 180) || "No description found.") +
          (problem.description?.length > 180 ? "…" : "");
      if (actionBtns) actionBtns.style.display = "flex";
      if (levelBadges) levelBadges.style.display = "flex";
      if (similarEmpty) similarEmpty.style.display = "block";
      updateLevelBadges();

      // Trigger precomputation for Level 1 as soon as problem is detected
      precomputeHint(1);
    } else {
      if (noProblem) {
        noProblem.style.display = "flex";
        noProblem.querySelector("strong").textContent =
          "Couldn't extract problem";
        noProblem.querySelector("span").textContent =
          "Try refreshing the problem page.";
      }
    }
  } catch (e) {
    if (noProblem) {
      noProblem.style.display = "flex";
      noProblem.querySelector("strong").textContent =
        "Content script not ready";
      noProblem.querySelector("span").textContent =
        "Refresh the problem page and try again.";
    }
  }
}

// ── Copy Button ──
if (copyBtn) {
  copyBtn.addEventListener("click", () => {
    const text = outputText?.innerText || "";
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = "Copy";
      }, 1500);
    });
  });
}

// ── Event Listeners ──
if (getHintBtn)
  getHintBtn.addEventListener("click", () => {
    selectedLevel = 1;
    completedLevels.clear();
    sessionHints = {};
    updateLevelBadges();
    getHints();
  });

if (nextHintBtn) {
  nextHintBtn.addEventListener("click", () => {
    if (selectedLevel < 3) {
      selectedLevel++;
      updateLevelBadges();
      getHints();
    }
  });
}

if (similarBtn) similarBtn.addEventListener("click", getSimilarProblems);

// ── Init ──
async function init() {
  DEVICE_ID = await getDeviceId();
  if (deviceIdDisp) deviceIdDisp.textContent = DEVICE_ID;
  detectProblem();
  checkServerHealth();
  loadKeyStatus();
  updateLevelBadges();
}

init();