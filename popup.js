/**
 * popup.js — merged: local backend (streaming + history) + Gemini API fallback
 * Supports: device ID, server health, local SSE streaming hints, Gemini API calls,
 *           settings (store API key), history, similar problems, and UI wiring.
 */

const API_BASE_URL = "http://localhost:3001/api";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

let DEVICE_ID = "";
let currentProblem = null;
let selectedLevel = 1;

// DOM refs (union of both branches)
const $ = id => document.getElementById(id);
const problemCard = $("problem-card");
const noProblem = $("no-problem");
const problemTitle = $("problem-title");
const problemDesc = $("problem-desc");
const problemPlatform = $("problem-platform");
const hintControls = $("hint-controls");
const codeSection = $("code-section");
const actionBtns = $("action-btns");
const getHintBtn = $("get-hint-btn");
const similarBtn = $("similar-btn");
const userCode = $("user-code");
const loader = $("loader");
const loaderText = $("loader-text");
const outputBox = $("output-box");
const outputText = $("output-text");
const outputTag = $("output-tag");
const copyBtn = $("copy-btn");
const statusDot = $("status-dot");
const apiKeyInput = $("api-key-input");
const saveKeyBtn = $("save-key-btn");
const keyStatus = $("key-status");
const deviceIdDisp = $("device-id-display");
const serverStatusIcon = $("server-status-icon");
const serverStatusText = $("server-status-text");
const historyContainer = $("history-container");
const historyEmpty = $("history-empty");

// Utilities
function showLoader(msg = "Thinking…") {
  if (loaderText) loaderText.textContent = msg;
  if (loader) loader.classList.add("visible");
  if (outputBox) outputBox.classList.remove("visible");
  if (getHintBtn) getHintBtn.disabled = true;
  if (similarBtn) similarBtn.disabled = true;
}

function hideLoader() {
  if (loader) loader.classList.remove("visible");
  if (getHintBtn) getHintBtn.disabled = false;
  if (similarBtn) similarBtn.disabled = false;
}

function renderMarkdown(text) {
  return text
    .replace(/### (.+)/g, '<h3>$1</h3>')
    .replace(/## (.+)/g,  '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n/g, '<br>');
}

function setOutput(html, tag) {
  if (outputTag) outputTag.textContent = tag;
  if (outputText) outputText.innerHTML = html;
  if (outputBox) outputBox.classList.add("visible");
  hideLoader();
}

function setOutputFromText(text, tag) {
  setOutput(renderMarkdown(text), tag);
}

// Storage helpers
function getDeviceId() {
  return new Promise(resolve => {
    chrome.storage.local.get("dsa_device_id", data => {
      if (data.dsa_device_id) {
        resolve(data.dsa_device_id);
      } else {
        const newId = 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        chrome.storage.local.set({ dsa_device_id: newId }, () => resolve(newId));
      }
    });
  });
}

function getStoredKey() {
  return new Promise(resolve => {
    chrome.storage.local.get("gemini_api_key", data => {
      resolve(data.gemini_api_key || null);
    });
  });
}

// Theme toggle (kept from main branch)
(function () {
  const root = document.documentElement;
  const toggleBtn = $("theme-toggle");
  const knob = $("theme-knob");
  if (!toggleBtn) return;

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (knob) knob.textContent = theme === 'light' ? '☀️' : '🌙';
    try { localStorage.setItem('cma-theme', theme); } catch (e) {}
  }

  let saved = 'dark';
  try { saved = localStorage.getItem('cma-theme') || 'dark'; } catch (e) {}
  applyTheme(saved);

  toggleBtn.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(current);
  });
})();

// Tabs
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    const panel = $(`tab-${tab.dataset.tab}`);
    if (panel) panel.classList.add("active");
    if (tab.dataset.tab === 'history') {
      fetchHistory();
    }
  });
});

// Hint levels
document.querySelectorAll(".level-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".level-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedLevel = parseInt(btn.dataset.level);
  });
});

// Save key UI
if (saveKeyBtn) {
  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput?.value.trim();
    if (!key) { if (keyStatus) keyStatus.textContent = "Enter a key first."; return; }
    chrome.storage.local.set({ gemini_api_key: key }, () => {
      if (keyStatus) { keyStatus.textContent = "✓ Key saved"; keyStatus.className = "key-status ok"; }
      if (apiKeyInput) apiKeyInput.value = "";
      setTimeout(() => { if (keyStatus) keyStatus.textContent = "Key stored ✓"; }, 1500);
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
    keyStatus.textContent = "No key stored — add one in Settings";
    keyStatus.className = "key-status";
  }
}

// Server health (local backend)
async function checkServerHealth() {
  if (!serverStatusIcon || !serverStatusText) return;
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (res.ok) {
      serverStatusIcon.textContent = "🟢";
      serverStatusText.textContent = "Connected to localhost:3001";
      serverStatusText.style.color = "var(--green)";
      return true;
    }
  } catch (e) {
    serverStatusIcon.textContent = "🔴";
    serverStatusText.textContent = "Backend offline (start server)";
    serverStatusText.style.color = "var(--red)";
  }
  return false;
}

// Local streaming hints (kept from main)
async function getHintsLocal() {
  if (!currentProblem) return;

  showLoader("Streaming hint…");
  try {
    const response = await fetch(`${API_BASE_URL}/hint`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": DEVICE_ID },
      body: JSON.stringify({ problem: currentProblem, level: selectedLevel, stream: true })
    });

    if (!response.ok) throw new Error("API Error");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let done = false;
    let fullText = "";

    outputTag.textContent = `HINT • LEVEL ${selectedLevel}`;
    outputText.innerHTML = "";
    outputBox.classList.add("visible");
    hideLoader();

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '');
            if (dataStr === '[DONE]') { done = true; break; }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.token) {
                fullText += parsed.token;
                outputText.innerHTML = renderMarkdown(fullText);
                outputText.scrollTop = outputText.scrollHeight;
              }
            } catch (e) {}
          }
        }
      }
    }
  } catch (err) {
    hideLoader();
    setOutput(`⚠️ Error connecting to local backend: ${err.message}`, "ERROR");
    throw err;
  }
}

// Gemini call (kept from incoming)
async function callGemini(prompt, retries = 2) {
  const apiKey = await getStoredKey();
  if (!apiKey) {
    return "⚠️ No API key found. Go to the **Settings** tab and add your Gemini API key.";
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
      })
    });

    if (res.status === 429) {
      if (attempt < retries) {
        const wait = 5000 * (attempt + 1);
        showLoader(`Rate limited — retrying in ${wait / 1000}s…`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      return "⚠️ Quota exceeded. Wait a minute and try again, or check your Gemini API billing at https://ai.dev/rate-limit";
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return `⚠️ API error ${res.status}: ${err?.error?.message || "Unknown error"}`;
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response received.";
  }
}

// Wrapper: decide local backend vs Gemini
async function getHints() {
  if (!currentProblem) return;

  // Try local backend first; if unavailable, fall back to Gemini (if key present)
  const hasLocal = await checkServerHealth();
  if (hasLocal) {
    try { await getHintsLocal(); return; } catch (e) { /* fallthrough to Gemini */ }
  }

  // Build Gemini prompt (from incoming branch)
  const code = userCode?.value.trim();
  const prompt = `\nYou are a DSA mentor. A student is solving this problem:\n\n**Problem:** ${currentProblem.title}\n**Description:** ${currentProblem.description}\n**Examples:**\n${currentProblem.examples}\n\n${code ? `**Their current code:**\n\`\`\`\n${code}\n\`\`\`` : ""}\n\nProvide a **Level ${selectedLevel}** hint (1=very subtle nudge, 2=high-level approach, 3=specific algorithm, 4=step-by-step skeleton).`.trim();

  showLoader("Generating hint…");
  const result = await callGemini(prompt);
  setOutputFromText(result, `HINT • LEVEL ${selectedLevel}`);
}

// Similar problems: try local then fallback to Gemini
async function getSimilarProblems() {
  if (!currentProblem) return;

  showLoader("Finding similar problems…");
  try {
    // Try local similar endpoint
    const res = await fetch(`${API_BASE_URL}/similar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": DEVICE_ID },
      body: JSON.stringify({ problem: currentProblem })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.source === 'rag-decomposed' && data.concepts?.length) {
        let html = "";
        data.concepts.forEach(conceptGrp => {
          html += `<div class="section-label" style="margin-top: 12px; margin-bottom: 8px;">${conceptGrp.label}</div>`;
          conceptGrp.problems.forEach(sim => {
            let diffColor = "sim-badge easy";
            if(sim.difficulty === "Medium") diffColor = "sim-badge medium";
            if(sim.difficulty === "Hard") diffColor = "sim-badge hard";
            html += `
              <div class="similar-item">
                <div class="similar-title">
                  <a href="${sim.url}" target="_blank">${sim.title} ↗</a>
                </div>
                <div class="similar-meta">
                  <span class="sim-badge sim-score">${conceptGrp.concept}</span>
                  ${sim.difficulty ? `<span class="${diffColor}">${sim.difficulty}</span>` : ''}
                </div>
              </div>
            `;
          });
        });
        setOutput(html, "FOUNDATIONAL CONCEPTS");
        return;
      } else if (data.source === 'rag' && data.similar?.length) {
        let html = "";
        data.similar.forEach(sim => {
          let diffColor = "sim-badge easy";
          if(sim.difficulty === "Medium") diffColor = "sim-badge medium";
          if(sim.difficulty === "Hard") diffColor = "sim-badge hard";
          html += `
            <div class="similar-item">
              <div class="similar-title">
                <a href="${sim.url}" target="_blank">${sim.title} ↗</a>
              </div>
              <div class="similar-meta">
                <span class="sim-badge sim-score">${sim.similarity}% Match</span>
                ${sim.difficulty ? `<span class="${diffColor}">${sim.difficulty}</span>` : ''}
                ${sim.topicTags?.length ? `<span class="sim-badge">${sim.topicTags.slice(0,2).join(', ')}</span>` : ''}
              </div>
              <div class="similar-reason">${sim.reason || ''}</div>
            </div>
          `;
        });
        setOutput(html, "SIMILAR PROBLEMS (RAG)");
        return;
      }
    }
  } catch (e) {
    // fallback to Gemini below
  }

  // Fallback: use Gemini to recommend similar problems
  const prompt = `\nYou are a competitive programming coach. A student solved this problem:\n\n**Problem:** ${currentProblem.title}\n**Description:** ${currentProblem.description.slice(0, 500)}\n\nRecommend exactly 3 similar LeetCode problems to practice the same concept. For each, provide:\n- Problem number and name\n- Why it's similar (one line)\n- Difficulty (Easy / Medium / Hard)\n\nFormat clearly with ### for each problem.`.trim();

  const resText = await callGemini(prompt);
  setOutputFromText(resText, "SIMILAR PROBLEMS");
}

// History
async function fetchHistory() {
  if (!historyContainer) return;
  historyContainer.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--muted)">Loading history...</td></tr>';
  if (historyEmpty) historyEmpty.style.display = "none";
  try {
    const res = await fetch(`${API_BASE_URL}/history?deviceId=${DEVICE_ID}`);
    if (!res.ok) throw new Error("Failed to fetch");
    const data = await res.json();
    historyContainer.innerHTML = '';
    if (!data.history || data.history.length === 0) { if (historyEmpty) historyEmpty.style.display = "block"; return; }
    data.history.forEach(item => {
      const dateStr = new Date(item.createdAt).toLocaleDateString();
      const tr = document.createElement("tr");
      const probTitle = item.problem ? item.problem.title : "Unknown Problem";
      const snippet = (item.content || '').replace(/#/g, '').slice(0, 150) + "...";
      tr.innerHTML = `
        <td class="history-date">${dateStr}</td>
        <td class="history-prob" title="${probTitle}">${probTitle}</td>
        <td><span class="history-lvl">Lvl ${item.level}</span></td>
        <td><div class="history-snippet">${snippet}</div></td>
      `;
      historyContainer.appendChild(tr);
    });
  } catch (e) {
    historyContainer.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--red)">Failed to load history. Is backend running?</td></tr>`;
  }
}

// Problem detection (merged logic)
async function detectProblem() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  const isLeetCode = url.includes("leetcode.com/problems/");
  const isCodeforces = url.includes("codeforces.com/problemset/") ||
                       url.includes("codeforces.com/contest/") ||
                       url.includes("codeforces.com/gym/");

  if (!isLeetCode && !isCodeforces) {
    if (noProblem) noProblem.style.display = "flex";
    if (problemCard) problemCard.classList.remove("visible");
    if (hintControls) hintControls.style.display = "none";
    if (codeSection) codeSection.style.display = "none";
    if (actionBtns) actionBtns.style.display = "none";
    return;
  }

  if (statusDot) { statusDot.classList.add("on-leetcode"); statusDot.title = "Active on supported page"; }

  try {
    const problem = await chrome.tabs.sendMessage(tab.id, { action: "getProblem" });
    if (problem?.title || problem?.description) {
      currentProblem = problem;
      currentProblem.platform = isLeetCode ? "leetcode" : "codeforces";
      currentProblem.url = url;
      if (noProblem) noProblem.style.display = "none";
      if (problemCard) problemCard.classList.add("visible");
      if (problemTitle) {
        const platformHtml = `<span class="platform-badge" id="problem-platform">${isLeetCode ? 'LC' : 'CF'}</span>`;
        problemTitle.innerHTML = `${problem.title || 'Untitled Problem'} ${platformHtml}`;
      }
      if (problemDesc) problemDesc.textContent = problem.description?.slice(0, 180) + (problem.description?.length > 180 ? "…" : "") || "No description found.";
      if (hintControls) hintControls.style.display = "block";
      if (codeSection) codeSection.style.display = "block";
      if (actionBtns) actionBtns.style.display = "flex";
    } else {
      if (noProblem) {
        noProblem.style.display = "flex";
        noProblem.querySelector("strong").textContent = "Couldn't extract problem";
        noProblem.querySelector("span").textContent = "Try refreshing the problem page.";
      }
    }
  } catch (e) {
    if (noProblem) {
      noProblem.style.display = "flex";
      noProblem.querySelector("strong").textContent = "Content script not ready";
      noProblem.querySelector("span").textContent = "Refresh the problem page and try again.";
    }
  }
}

// Copy
if (copyBtn) {
  copyBtn.addEventListener("click", () => {
    const text = outputText?.innerText || '';
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = "✅";
      setTimeout(() => { if (copyBtn) copyBtn.textContent = "📋"; }, 1500);
    });
  });
}

// Event listeners
if (getHintBtn) getHintBtn.addEventListener("click", getHints);
if (similarBtn) similarBtn.addEventListener("click", getSimilarProblems);

// Init
async function init() {
  DEVICE_ID = await getDeviceId();
  if (deviceIdDisp) deviceIdDisp.textContent = DEVICE_ID;
  detectProblem();
  checkServerHealth();
  loadKeyStatus();
}

init();
