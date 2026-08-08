/**
 * popup.js — DSA Hint Assistant (Backend Integrated)
 * Handles: problem detection, UI state, history fetching,
 *          similar problems, and SSE hint streaming from the local server.
 */

const API_BASE_URL = "http://localhost:3001/api";
let DEVICE_ID = "";
let currentProblem = null;
let selectedLevel = 1;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const problemCard   = $("problem-card");
const noProblem     = $("no-problem");
const problemTitle  = $("problem-title");
const problemDesc   = $("problem-desc");
const problemPlatform = $("problem-platform");
const hintControls  = $("hint-controls");
const actionBtns    = $("action-btns");
const getHintBtn    = $("get-hint-btn");
const similarBtn    = $("similar-btn");
const loader        = $("loader");
const loaderText    = $("loader-text");
const outputBox     = $("output-box");
const outputText    = $("output-text");
const outputTag     = $("output-tag");
const copyBtn       = $("copy-btn");
const statusDot     = $("status-dot");
const deviceIdDisp  = $("device-id-display");
const serverStatusIcon = $("server-status-icon");
const serverStatusText = $("server-status-text");
const historyContainer = $("history-container");
const historyEmpty  = $("history-empty");

// ─── Utility ──────────────────────────────────────────────────────────────────
function showLoader(msg = "Thinking…") {
  loaderText.textContent = msg;
  loader.classList.add("visible");
  outputBox.classList.remove("visible");
  getHintBtn.disabled = true;
  similarBtn.disabled = true;
}

function hideLoader() {
  loader.classList.remove("visible");
  getHintBtn.disabled = false;
  similarBtn.disabled = false;
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
  outputTag.textContent = tag;
  outputText.innerHTML = html;
  outputBox.classList.add("visible");
  hideLoader();
}

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

// ─── Theme toggle ─────────────────────────────────────────────────────────────
(function () {
  const root = document.documentElement;
  const toggleBtn = $("theme-toggle");
  const knob = $("theme-knob");

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    knob.textContent = theme === 'light' ? '☀️' : '🌙';
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

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
    
    if (tab.dataset.tab === 'history') {
      fetchHistory();
    }
  });
});

// ─── Hint level selection ─────────────────────────────────────────────────────
document.querySelectorAll(".level-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".level-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedLevel = parseInt(btn.dataset.level);
  });
});

// ─── Core API Methods ─────────────────────────────────────────────────────────

async function checkServerHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (res.ok) {
      serverStatusIcon.textContent = "🟢";
      serverStatusText.textContent = "Connected to localhost:3001";
      serverStatusText.style.color = "var(--green)";
    }
  } catch (e) {
    serverStatusIcon.textContent = "🔴";
    serverStatusText.textContent = "Backend offline (start server)";
    serverStatusText.style.color = "var(--red)";
  }
}

async function getHints() {
  if (!currentProblem) return;

  showLoader("Streaming hint…");
  
  try {
    const response = await fetch(`${API_BASE_URL}/hint`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": DEVICE_ID },
      body: JSON.stringify({
        problem: currentProblem,
        level: selectedLevel,
        stream: true
      })
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
                // Scroll to bottom optionally
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
  }
}

async function getSimilarProblems() {
  if (!currentProblem) return;

  showLoader("Finding similar problems…");
  
  try {
    const response = await fetch(`${API_BASE_URL}/similar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": DEVICE_ID },
      body: JSON.stringify({ problem: currentProblem })
    });

    if (!response.ok) throw new Error("API Error");
    const data = await response.json();
    
    if (data.source === 'rag-decomposed' && data.concepts && data.concepts.length > 0) {
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
    } else if (data.source === 'rag' && data.similar.length > 0) {
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
    } else {
      // Fallback LLM string rendering
      let rawText = Array.isArray(data.similar) ? data.similar.join('\n\n') : data.similar;
      setOutput(renderMarkdown(rawText), "SIMILAR PROBLEMS (LLM)");
    }
  } catch (err) {
    hideLoader();
    setOutput(`⚠️ Error connecting to local backend: ${err.message}`, "ERROR");
  }
}

async function fetchHistory() {
  historyContainer.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--muted)">Loading history...</td></tr>';
  historyEmpty.style.display = "none";
  
  try {
    const res = await fetch(`${API_BASE_URL}/history?deviceId=${DEVICE_ID}`);
    if (!res.ok) throw new Error("Failed to fetch");
    const data = await res.json();
    
    historyContainer.innerHTML = '';
    
    if (!data.history || data.history.length === 0) {
      historyEmpty.style.display = "block";
      return;
    }
    
    data.history.forEach(item => {
      const dateStr = new Date(item.createdAt).toLocaleDateString();
      const tr = document.createElement("tr");
      
      const probTitle = item.problem ? item.problem.title : "Unknown Problem";
      const snippet = item.content.replace(/#/g, '').slice(0, 150) + "...";
      
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

// ─── Problem Detection ────────────────────────────────────────────────────────
async function detectProblem() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  const isLeetCode  = url.includes("leetcode.com/problems/");
  const isCodeforces = url.includes("codeforces.com/problemset/") ||
                     url.includes("codeforces.com/contest/") ||
                     url.includes("codeforces.com/gym/");

  if (!isLeetCode && !isCodeforces) {
    noProblem.style.display = "flex";
    problemCard.classList.remove("visible");
    hintControls.style.display = "none";
    actionBtns.style.display = "none";
    return;
  }

  statusDot.classList.add("on-leetcode");
  statusDot.title = "Active on supported page";
  problemPlatform.textContent = isLeetCode ? "LC" : "CF";

  try {
    const problem = await chrome.tabs.sendMessage(tab.id, { action: "getProblem" });

    if (problem?.title || problem?.description) {
      currentProblem = problem;
      currentProblem.platform = isLeetCode ? "leetcode" : "codeforces";
      currentProblem.url = url;
      
      noProblem.style.display = "none";
      problemCard.classList.add("visible");
      
      // Keep title text next to badge
      const platformHtml = `<span class="platform-badge" id="problem-platform">${isLeetCode ? 'LC' : 'CF'}</span>`;
      problemTitle.innerHTML = `${problem.title || "Untitled Problem"} ${platformHtml}`;
      
      problemDesc.textContent  = problem.description?.slice(0, 180) + (problem.description?.length > 180 ? "…" : "") || "No description found.";
      hintControls.style.display = "block";
      actionBtns.style.display   = "flex";
    } else {
      noProblem.style.display = "flex";
      noProblem.querySelector("strong").textContent = "Couldn't extract problem";
      noProblem.querySelector("span").textContent   = "Try refreshing the problem page.";
    }
  } catch (e) {
    // Content script might not be injected yet
    noProblem.style.display = "flex";
    noProblem.querySelector("strong").textContent = "Content script not ready";
    noProblem.querySelector("span").textContent   = "Refresh the problem page and try again.";
  }
}

// ─── Copy to clipboard ────────────────────────────────────────────────────────
copyBtn.addEventListener("click", () => {
  const text = outputText.innerText;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "✅";
    setTimeout(() => { copyBtn.textContent = "📋"; }, 1500);
  });
});

// ─── Event listeners ──────────────────────────────────────────────────────────
getHintBtn.addEventListener("click", getHints);
similarBtn.addEventListener("click", getSimilarProblems);

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  DEVICE_ID = await getDeviceId();
  deviceIdDisp.textContent = DEVICE_ID;
  detectProblem();
  checkServerHealth();
}

init();
