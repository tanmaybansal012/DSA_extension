# DSA Hint Assistant

DSA Hint Assistant is a lightweight, productivity-focused Chrome Extension engineered for software engineers, competitive programmers, and students looking to optimize their Data Structures and Algorithms (DSA) preparation.

Instead of immediately jumping to full solutions or reading lengthy editorials when stuck, the extension acts as an interactive mentor directly within the browser tab. By extracting runtime page context from active coding problem screens using a dynamic content script, it securely interfaces with the Gemini 2.0 Flash API to generate intelligent, context-aware hints tailored to the user’s current progress.

## ✨ Key Features

* **Context-Aware Hint Generation**
  Automatically analyzes the currently opened problem statement and provides personalized hints based on the problem context.

* **Step-by-Step Guidance**
  Offers progressive hints that guide users toward the solution without directly revealing the complete answer.

* **Smart Problem Understanding**
  Extracts relevant information such as constraints, examples, and problem descriptions from supported coding platforms.

* **Lightweight & Fast**
  Designed with minimal overhead to ensure a smooth browsing and coding experience.

* **AI-Powered Assistance**
  Utilizes the Gemini 2.0 Flash API for rapid response generation and efficient contextual reasoning.

* **Productivity-Focused Workflow**
  Helps users stay focused on problem solving while reducing dependency on external editorials and discussion forums.

## 🛠️ Tech Stack

* **Frontend:** HTML, CSS, JavaScript
* **Browser APIs:** Chrome Extension APIs, Content Scripts
* **AI Integration:** Gemini 2.0 Flash API
* **Architecture:** Runtime DOM extraction + prompt engineering pipeline

## 🚀 How It Works

1. The extension detects and reads the active coding problem page.
2. Relevant problem details are extracted dynamically from the DOM.
3. The extracted context is processed and sent securely to the Gemini API.
4. The AI generates structured hints based on the user’s likely progress.
5. Hints are displayed inside the extension popup in real time.

## 🎯 Project Goal

The primary goal of DSA Hint Assistant is to encourage independent problem-solving while still providing meaningful guidance when users get stuck. It bridges the gap between struggling alone and directly viewing complete solutions.

## 📌 Use Cases

* Competitive programming practice
* Interview preparation
* Learning new algorithms and techniques
* Reducing dependency on solution editorials
* Improving logical thinking and debugging skills

## 🔒 Privacy & Security

The extension only extracts information required for generating hints and securely communicates with the AI API. No unnecessary personal data is collected or stored.

## 🌟 Future Improvements

* Multi-platform support (LeetCode, Codeforces, CodeChef, etc.)
* Difficulty-based adaptive hints
* Voice-assisted hint system
* Personalized learning analytics
* Hint history and bookmarking support
* Multi-language support for explanations
