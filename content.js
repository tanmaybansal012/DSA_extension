const PLATFORMS = {
  "leetcode.com":    extractLeetCode,
  "codeforces.com":  extractCodeforces,
  "hackerrank.com":  extractHackerRank,
  "codechef.com":    extractCodeChef,
};

function extractProblem() {
  const host = window.location.hostname;
  for (const [domain, fn] of Object.entries(PLATFORMS)) {
    if (host.includes(domain)) return fn();
  }
  return extractGeneric();
}

function extractGeneric() {
  const title = extractTitle();
  const { description, examples } = extractMainContent();
  return { title, description, examples };
}

function extractTitle() {
  return (
    document.querySelector('h1')?.innerText ||
    document.querySelector('h2')?.innerText ||
    document.querySelector('meta[property="og:title"]')?.content ||
    document.title ||
    ""
  ).trim();
}

function extractMainContent() {
  const semanticEl =
    document.querySelector('main') ||
    document.querySelector('article') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('section');

  const container = semanticEl || scoreDivs();

  if (!container) return { description: "", examples: "" };

  const description = container.innerText.slice(0, 3000).trim();

  const examples = [...container.querySelectorAll('pre, code, blockquote')]
    .map(el => el.innerText.trim())
    .filter(t => t.length > 0)
    .join('\n---\n')
    .slice(0, 1500);

  return { description, examples };
}

function scoreDivs() {
  const candidates = [...document.querySelectorAll('div, section, td')];
  let best = null, bestScore = 0;

  for (const el of candidates) {
    if (el.offsetWidth < 200 || el.offsetHeight < 100) continue;
    if (/nav|header|footer|sidebar|menu|ad|cookie/i.test(
      el.className + " " + el.id
    )) continue;

    const text = el.innerText || "";
    const wordCount = text.trim().split(/\s+/).length;
    const htmlLen = el.innerHTML.length;
    if (htmlLen === 0) continue;

    const density = text.length / htmlLen;
    const score = wordCount * density;

    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function extractLeetCode() {
  const title =
    document.querySelector('div.text-title-large')?.innerText ||
    document.querySelector('[data-cy="question-title"]')?.innerText ||
    document.querySelector('h1')?.innerText || "";

  const descEl =
    document.querySelector('[data-track-load="description_content"]') ||
    document.querySelector('.elfjS') ||
    document.querySelector('[class*="description__"]');

  const description = descEl?.innerText || "";
  const examples = descEl
    ? [...descEl.querySelectorAll('pre')].map(e => e.innerText).join('\n---\n')
    : "";

  return { title: title.trim(), description: description.slice(0, 3000).trim(), examples };
}

function extractCodeforces() {
  const title = document.querySelector('.problem-statement .title')?.innerText || "";
  const descEl = document.querySelector('.problem-statement')?.children[1];
  const description = descEl?.innerText || "";

  const inputs  = [...document.querySelectorAll('.problem-statement .input pre')].map(e => e.innerText);
  const outputs = [...document.querySelectorAll('.problem-statement .output pre')].map(e => e.innerText);
  let examples = "";
  for (let counter = 0; counter < inputs.length; counter++) {
    examples += `Example ${counter + 1}:\nInput:\n${inputs[counter]}\nOutput:\n${outputs[counter]}\n\n`;
  }

  return { title: title.trim(), description: description.slice(0, 3000).trim(), examples: examples.trim() };
}

function extractHackerRank() {
  const title = document.querySelector('.challenge-page-label')?.innerText ||
                document.querySelector('h1')?.innerText || "";
  const descEl = document.querySelector('.challenge-body-html') ||
                 document.querySelector('.problem-statement');
  const description = descEl?.innerText || "";
  const examples = [...(descEl?.querySelectorAll('pre') || [])].map(e => e.innerText).join('\n---\n');
  return { title: title.trim(), description: description.slice(0, 3000).trim(), examples };
}

function extractCodeChef() {
  const title = document.querySelector('.problem-name')?.innerText ||
                document.querySelector('h1')?.innerText || "";
  const descEl = document.querySelector('#problem-statement') ||
                 document.querySelector('.problem-statement');
  const description = descEl?.innerText || "";
  const examples = [...(descEl?.querySelectorAll('pre') || [])].map(e => e.innerText).join('\n---\n');
  return { title: title.trim(), description: description.slice(0, 3000).trim(), examples };
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "getProblem") {
    sendResponse(extractProblem());
  }
  return true;
});
