let activeUI = null;
let floatingButton = null;
let selectedText = "";
let selectionRect = null;

console.log("QuickAI content script loaded on:", window.location.href);

// Handle text selection
document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (text.length > 0 && !activeUI) {
    selectedText = text;
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      selectionRect = range.getBoundingClientRect();
      showFloatingButton();
    }
  } else if (text.length === 0) {
    hideFloatingButton();
  }
});

// Show floating question mark button
function showFloatingButton() {
  if (floatingButton) return;

  floatingButton = document.createElement("button");
  floatingButton.id = "quickai-trigger-button";
  floatingButton.innerHTML = "?";
  floatingButton.title = "Ask QuickAI";

  // Position near selection
  const top = window.scrollY + selectionRect.bottom + 5;
  const left = window.scrollX + selectionRect.left;

  floatingButton.style.top = `${top}px`;
  floatingButton.style.left = `${left}px`;

  // Add click handler
  floatingButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideFloatingButton();
    createFloatingUI(selectionRect, selectedText);
  });

  document.body.appendChild(floatingButton);
}

// Hide floating button
function hideFloatingButton() {
  if (floatingButton) {
    floatingButton.remove();
    floatingButton = null;
  }
}

// Create the floating UI
async function createFloatingUI(rect, contextText) {
  try {
    console.log("Creating floating UI...");

    if (activeUI) activeUI.remove();

    const container = document.createElement("div");
    container.id = "quickai-container";
    container.className = "quickai-container";

    // Position near selected text
    const top = window.scrollY + rect.bottom + 10;
    const left = window.scrollX + rect.left;

    container.style.top = `${top}px`;
    container.style.left = `${left}px`;

    // Load available models and last selected model
    const models = await getModels();
    const { lastModel } = await chrome.storage.sync.get("lastModel");
    const defaultModel = lastModel || models[0].id;

    console.log("Models loaded:", models.length, "Last model:", defaultModel);

    container.innerHTML = `
            <div class="quickai-gradient-border"></div>
            <div class="quickai-content">
                <div class="quickai-header">
                    <span class="quickai-title">QuickAI</span>
                    <button id="quickai-close" class="quickai-close">&times;</button>
                </div>
                <div class="quickai-context">
                    <strong>Context:</strong> <span class="quickai-context-text">${escapeHtml(
                      contextText.substring(0, 100)
                    )}${contextText.length > 100 ? "..." : ""}</span>
                </div>
                <div id="quickai-response" class="quickai-response"></div>
                <div class="quickai-input-area">
                    <textarea id="quickai-prompt" class="quickai-prompt" placeholder="Ask a question about the selected text..." rows="3"></textarea>
                    <div class="quickai-controls">
                        <select id="quickai-model" class="quickai-model-select">
                            ${models
                              .map(
                                (m) =>
                                  `<option value="${m.id}" ${
                                    m.id === defaultModel ? "selected" : ""
                                  }>${m.name}</option>`
                              )
                              .join("")}
                        </select>
                        <button id="quickai-submit" class="quickai-submit">Submit</button>
                    </div>
                </div>
            </div>
        `;

    document.body.appendChild(container);
    activeUI = container;

    // Add event listeners
    document.getElementById("quickai-close").addEventListener("click", closeUI);
    document
      .getElementById("quickai-submit")
      .addEventListener("click", () => submitQuery(contextText));
    document
      .getElementById("quickai-prompt")
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.ctrlKey) {
          submitQuery(contextText);
        }
      });

    // Save model selection
    document.getElementById("quickai-model").addEventListener("change", (e) => {
      chrome.storage.sync.set({ lastModel: e.target.value });
    });

    // Focus on textarea
    document.getElementById("quickai-prompt").focus();

    console.log("Floating UI created successfully");
  } catch (error) {
    console.error("Error creating floating UI:", error);
    activeUI = null;
  }
}

// Submit query to AI
async function submitQuery(contextText) {
  const prompt = document.getElementById("quickai-prompt").value.trim();
  const model = document.getElementById("quickai-model").value;
  const responseArea = document.getElementById("quickai-response");
  const submitBtn = document.getElementById("quickai-submit");

  if (!prompt) return;

  // Show loading state
  responseArea.innerHTML = '<div class="quickai-loader"></div>';
  submitBtn.disabled = true;
  submitBtn.textContent = "Processing...";

  // Clear response area for streaming
  responseArea.innerHTML = "";
  responseArea.dataset.fullResponse = ""; // Store full response for copying

  // Send to service worker
  chrome.runtime.sendMessage({
    type: "queryAI",
    context: contextText,
    prompt: prompt,
    model: model,
  });
}

// Handle streaming responses
chrome.runtime.onMessage.addListener((message) => {
  const responseArea = document.getElementById("quickai-response");
  const submitBtn = document.getElementById("quickai-submit");

  if (!responseArea) return;

  switch (message.type) {
    case "streamStart":
      responseArea.innerHTML = "";
      responseArea.dataset.fullResponse = "";
      break;

    case "streamChunk":
      responseArea.innerHTML += message.content;
      responseArea.dataset.fullResponse =
        (responseArea.dataset.fullResponse || "") + message.rawContent;
      responseArea.scrollTop = responseArea.scrollHeight;
      break;

    case "streamEnd":
      // Add copy button
      const copyBtn = document.createElement("button");
      copyBtn.className = "quickai-copy-btn";
      copyBtn.innerHTML = "📋 Copy";
      copyBtn.onclick = () => copyResponse(responseArea.dataset.fullResponse);
      responseArea.appendChild(copyBtn);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit";
      }
      break;

    case "streamError":
      responseArea.innerHTML = `<div class="quickai-error">Error: ${escapeHtml(
        message.error
      )}</div>`;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit";
      }
      break;
  }
});

// Copy response to clipboard
async function copyResponse(text) {
  try {
    await navigator.clipboard.writeText(text);

    // Show feedback
    const copyBtn = document.querySelector(".quickai-copy-btn");
    if (copyBtn) {
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = "✅ Copied!";
      copyBtn.style.background = "#4caf50";

      setTimeout(() => {
        copyBtn.innerHTML = originalText;
        copyBtn.style.background = "";
      }, 2000);
    }
  } catch (error) {
    console.error("Failed to copy:", error);
    alert("Failed to copy to clipboard");
  }
}

// Handle context menu trigger
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "createUIFromContextMenu" && message.text) {
    console.log("Creating UI from context menu with text:", message.text);

    // Get current mouse position or use center of viewport
    const rect = {
      bottom: window.innerHeight / 2,
      left: window.innerWidth / 2 - 225,
      top: window.innerHeight / 2 - 50,
      right: window.innerWidth / 2 + 225,
    };

    // If there's a selection, use its position instead
    const selection = window.getSelection();
    if (selection.rangeCount > 0 && selection.toString().trim()) {
      const range = selection.getRangeAt(0);
      const selectionRect = range.getBoundingClientRect();
      if (selectionRect.width > 0 && selectionRect.height > 0) {
        Object.assign(rect, selectionRect);
      }
    }

    hideFloatingButton();
    createFloatingUI(rect, message.text);
    sendResponse({ success: true });
  }
});

// Close UI
function closeUI() {
  if (activeUI) {
    activeUI.remove();
    activeUI = null;
  }
}

// Get available models
async function getModels() {
  try {
    // Dynamically load models from models.js
    const response = await fetch(chrome.runtime.getURL("models.js"));
    const text = await response.text();

    // Extract the models array using a safe method
    // This looks for the models array definition and parses it
    const match = text.match(/const\s+models\s*=\s*(\[[\s\S]*?\]);/);

    if (match && match[1]) {
      // Use Function constructor as a safer alternative to eval
      const modelsArray = new Function("return " + match[1])();
      console.log("Loaded", modelsArray.length, "models from models.js");
      return modelsArray;
    }

    throw new Error("Could not parse models from models.js");
  } catch (error) {
    console.error("Failed to load models from models.js:", error);

    // Fallback to default models if loading fails
    return [
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "anthropic/claude-sonnet-4", name: "Claude 4 Sonnet" },
      { id: "anthropic/claude-opus-4", name: "Claude 4 Opus" },
      { id: "anthropic/claude-sonnet-4", name: "Claude 4 Sonnet" },
      { id: "openai/gpt-4.1", name: "GPT-4.1" },
      { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
    ];
  }
}

// Escape HTML for security
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Click outside to close
document.addEventListener("click", (e) => {
  if (activeUI && !activeUI.contains(e.target) && e.target !== floatingButton) {
    const selection = window.getSelection();
    if (selection.toString().trim() === "") {
      closeUI();
    }
  }
});
