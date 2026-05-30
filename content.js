// changing the code from hardcoding to extrecting direct 
function extractProblem() {
  const isCodeforces = window.location.hostname.includes("codeforces.com");
  
  if (isCodeforces) {
    return extractCodeforces();
  } else {
    return extractLeetCode();
  }
}

function extractLeetCode() {
  const title =
    document.querySelector('div.text-title-large')?.innerText ||
    document.querySelector('[data-cy="question-title"]')?.innerText ||
    document.querySelector('h4.mr-2')?.innerText ||
    document.querySelector('h1')?.innerText || "";

  const descEl =
    document.querySelector('[data-track-load="description_content"]') ||
    document.querySelector('.elfjS') || 
    document.querySelector('[class*="description__"]');

  const description = descEl?.innerText || "";

  const examples = descEl ? 
    [...descEl.querySelectorAll('pre')].map(e => e.innerText).join('\n---\n') : "";

  return { 
    title: title.trim(), 
    description: description.slice(0, 3000).trim(), 
    examples 
  };
}

function extractCodeforces() {
  const title = document.querySelector('.problem-statement .title')?.innerText || "";

  const descEl = document.querySelector('.problem-statement')?.children[1]; 
  const description = descEl?.innerText || "";

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

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "getProblem") {
    sendResponse(extractProblem());
  }
  return true; 
});
