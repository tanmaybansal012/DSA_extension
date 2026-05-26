/**
 * background.js — Service Worker
 * Minimal background script required by manifest_version: 3.
 * Handles extension lifecycle events.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("DSA Hint Assistant installed.");
});
