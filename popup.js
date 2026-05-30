const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

let currentProblem = null;
let selectedLevel = 1;

const $ = id => document.getElementById(id);
const problemCard   = $("problem-card");
const noProblem     = $("no-problem");
const problemTitle  = $("problem-title");
const problemDesc   = $("problem-desc");
const hintControls  = $("hint-controls");
const codeSection   = $("code-section");
const actionBtns    = $("action-btns");
const getHintBtn    = $("get-hint-btn");
const similarBtn    = $("similar-btn");
const userCode      = $("user-code");
const loader        = $("loader");
const loaderText    = $("loader-text");
const outputBox     = $("output-box");
const outputText    = $("output-text");
const outputTag     = $("output-tag");
const copyBtn       = $("copy-btn");
const statusDot     = $("status-dot");
const apiKeyInput   = $("api-key-input");
const saveKeyBtn    = $("save-key-btn");
const keyStatus     = $("key-status");

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

function showOutput(text, tag) {
  outputTag.textContent = tag;
  const rendered = text
    .replace(/### (.+)/g, '<br><strong style="color:var(--accent2)">$1</strong><br>')
    .replace(/## (.+)/g,  '<br><strong style="color:var(--accent); font-size:13px">$1</strong><br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--surface2);padding:1px 5px;border-radius:4px;color:var(--green)">$1</code>')
    .replace(/^- (.+)/gm, '&nbsp;&nbsp;• $1')
    .replace(/\n/g, '<br>');
  outputText.innerHTML = rendered;
  outputBox.classList.add("visible");
  hideLoader();
}

function getStoredKey() {
  return new Promise(resolve => {
    chrome.storage.local.get("gemini_api_key", data => {
      resolve(data.gemini_api_key || null);
    });
  });
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

document.querySelectorAll(".level-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".level-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedLevel = parseInt(btn.dataset.level);
  });
});

saveKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) { keyStatus.textContent = "Enter a key first."; return; }
  chrome.storage.local.set({ gemini_api_key: key }, () => {
    keyStatus.textContent = "✓ Key saved";
    keyStatus.className = "key-status ok";
    apiKeyInput.value = "";
    setTimeout(() => {
      keyStatus.textContent = "Key stored ✓";
    }, 1500);
  });
});

async function loadKeyStatus() {
  const key = await getStoredKey();
  if (key) {
    keyStatus.textContent = `Key stored ✓ (${key.slice(0, 6)}…)`;
    keyStatus.className = "key-status ok";
  } else {
    keyStatus.textContent = "No key stored — add one in Settings";
    keyStatus.className = "key-status";
  }
}

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

async function getHints() {
  if (!currentProblem) return;
  const code = userCode.value.trim();

  const prompt = `
You are a DSA mentor. A student is solving this problem:

**Problem:** ${currentProblem.title}
**Description:** ${currentProblem.description}
**Examples:**
${currentProblem.examples}

${code ? `**Their current code:**\n\`\`\`\n${code}\n\`\`\`` : ""}

Provide a **Level ${selectedLevel}** hint (1=very subtle nudge, 2=high-level approach, 3=specific algorithm, 4=step-by-step skeleton).

Structure your response EXACTLY like this:
## 💡 Hint Level ${selectedLevel}

### 🧠 Key Insight
[One sentence pointing them in the right direction without giving away the answer]

### 🗺️ Approach
[2-3 bullet points on the thinking process]

### 📊 Complexity Target
- Time: O(?)
- Space: O(?)

### 🔑 Data Structure / Algorithm
[Name the technique without giving the full solution]

${selectedLevel >= 3 ? "### 🪜 Step-by-Step Skeleton\n[Pseudocode outline — no real code]" : ""}

### ⚠️ Common Pitfalls
[1-2 edge cases to watch out for]
`.trim();

  showLoader("Generating hint…");
  const result = await callGemini(prompt);
  showOutput(result, `HINT • LEVEL ${selectedLevel}`);
}

async function getSimilarProblems() {
  if (!currentProblem) return;

  const prompt = `
You are a competitive programming coach. A student solved this problem:

**Problem:** ${currentProblem.title}
**Description:** ${currentProblem.description.slice(0, 500)}

Recommend exactly 3 similar LeetCode problems to practice the same concept.
For each, provide:
- Problem number and name
- Why it's similar (one line)
- Difficulty (Easy / Medium / Hard)

Format clearly with ### for each problem.
`.trim();

  showLoader("Finding similar problems…");
  const result = await callGemini(prompt);
  showOutput(result, "SIMILAR PROBLEMS");
}

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
    codeSection.style.display = "none";
    actionBtns.style.display = "none";
    return;
  }

  statusDot.classList.add("on-leetcode");
  statusDot.title = "Active on supported page";

  try {
    const problem = await chrome.tabs.sendMessage(tab.id, { action: "getProblem" });

    if (problem?.title || problem?.description) {
      currentProblem = problem;
      noProblem.style.display = "none";
      problemCard.classList.add("visible");
      problemTitle.textContent = problem.title || "Untitled Problem";
      problemDesc.textContent  = problem.description?.slice(0, 180) + (problem.description?.length > 180 ? "…" : "") || "No description found.";
      hintControls.style.display = "block";
      codeSection.style.display  = "block";
      actionBtns.style.display   = "flex";
    } else {
      noProblem.style.display = "flex";
      noProblem.querySelector("strong").textContent = "Couldn't extract problem";
      noProblem.querySelector("span").textContent   = "Try refreshing the problem page.";
    }
  } catch (e) {
    noProblem.style.display = "flex";
    noProblem.querySelector("strong").textContent = "Content script not ready";
    noProblem.querySelector("span").textContent   = "Refresh the problem page and try again.";
  }
}

copyBtn.addEventListener("click", () => {
  const text = outputText.innerText;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "✅";
    setTimeout(() => { copyBtn.textContent = "📋"; }, 1500);
  });
});

getHintBtn.addEventListener("click", getHints);
similarBtn.addEventListener("click", getSimilarProblems);

detectProblem();
loadKeyStatus();
