function extractProblem() {
  const isCodeforces = window.location.hostname.includes("codeforces.com");
  
  if (isCodeforces) {
    return extractCodeforces();
  } else {
    return extractLeetCode();
  }
}

// --- LEETCODE EXTRACTION ---
function extractLeetCode() {
  // Title: Targets newer dynamic layouts and fallback h4/h1 tags
  const title =
    document.querySelector('div.text-title-large')?.innerText ||
    document.querySelector('[data-cy="question-title"]')?.innerText ||
    document.querySelector('h4.mr-2')?.innerText ||
    document.querySelector('h1')?.innerText || "";

  // Description: Targets the exact shadow DOM/container LeetCode uses for problems
  const descEl =
    document.querySelector('[data-track-load="description_content"]') ||
    document.querySelector('.elfjS') || 
    document.querySelector('[class*="description__"]');

  const description = descEl?.innerText || "";

  // LeetCode examples are usually wrapped in <pre> tags inside the description
  const examples = descEl ? 
    [...descEl.querySelectorAll('pre')].map(e => e.innerText).join('\n---\n') : "";

  return { 
    title: title.trim(), 
    description: description.slice(0, 3000).trim(), 
    examples 
  };
}

// --- CODEFORCES EXTRACTION ---
function extractCodeforces() {
  // Title: Codeforces wraps titles inside a .title class within the problem statement
  const title = document.querySelector('.problem-statement .title')?.innerText || "";

  // Description: Grabs the core body, excluding the header (input/output specs)
  const descEl = document.querySelector('.problem-statement')?.children[1]; 
  const description = descEl?.innerText || "";

  // Codeforces cleanly separates inputs and outputs into .input and .output elements
  const inputs = [...document.querySelectorAll('.problem-statement .input pre')].map(e => e.innerText);
  const outputs = [...document.querySelectorAll('.problem-statement .output pre')].map(e => e.innerText);
  
  let examples = "";
  for (let i = 0; i < inputs.length; i++) {
    examples += `Example ${i + 1}:\nInput:\n${inputs[i]}\nOutput:\n${outputs[i]}\n\n`;
  }

  return { 
    title: title.trim(), 
    description: description.slice(0, 3000).trim(), 
    examples: examples.trim() 
  };
}

// Listener for the extension popup/background script
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "getProblem") {
    sendResponse(extractProblem());
  }
  return true; // Keeps the message channel open for asynchronous responses
});