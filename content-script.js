let activeUI = null;
let floatingButton = null;
let selectedText = "";
let selectionRect = null;
let fullContext = null;
let conversationHistory = []; // Track conversation messages

console.log("QuickAI content script loaded on:", window.location.href);

// Extract context paragraphs before and after selection
function extractFullContext(selection) {
  if (!selection || selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();
  
  // Get the common ancestor container
  const container = range.commonAncestorContainer;
  const parentElement = container.nodeType === Node.TEXT_NODE 
    ? container.parentElement 
    : container;
  
  // Find the closest block-level parent
  let blockParent = parentElement;
  while (blockParent && !isBlockElement(blockParent)) {
    blockParent = blockParent.parentElement;
  }
  
  if (!blockParent) return { selected: selectedText, before: "", after: "" };
  
  // Get surrounding paragraphs
  const paragraphs = [];
  let currentBlock = blockParent;
  
  // Get 2 paragraphs before
  const beforeBlocks = [];
  let prevBlock = getPreviousBlockElement(currentBlock);
  for (let i = 0; i < 2 && prevBlock; i++) {
    const blockText = prevBlock.textContent.trim();
    if (blockText) {
      beforeBlocks.unshift(blockText);
    }
    prevBlock = getPreviousBlockElement(prevBlock);
  }
  
  // Get 2 paragraphs after
  const afterBlocks = [];
  let nextBlock = getNextBlockElement(currentBlock);
  for (let i = 0; i < 2 && nextBlock; i++) {
    const blockText = nextBlock.textContent.trim();
    if (blockText) {
      afterBlocks.push(blockText);
    }
    nextBlock = getNextBlockElement(nextBlock);
  }
  
  const result = {
    selected: selectedText,
    before: beforeBlocks.join('\n\n'),
    after: afterBlocks.join('\n\n'),
    full: [...beforeBlocks, selectedText, ...afterBlocks].join('\n\n')
  };
  
  return result;
}

// Check if element is block-level
function isBlockElement(element) {
  const blockTags = ['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH'];
  return blockTags.includes(element.tagName);
}

// Get previous block-level sibling or parent's sibling
function getPreviousBlockElement(element) {
  let prev = element.previousElementSibling;
  while (prev && !isBlockElement(prev)) {
    prev = prev.previousElementSibling;
  }
  
  if (!prev && element.parentElement) {
    return getPreviousBlockElement(element.parentElement);
  }
  
  return prev;
}

// Get next block-level sibling or parent's sibling  
function getNextBlockElement(element) {
  let next = element.nextElementSibling;
  while (next && !isBlockElement(next)) {
    next = next.nextElementSibling;
  }
  
  if (!next && element.parentElement) {
    return getNextBlockElement(element.parentElement);
  }
  
  return next;
}

// Handle text selection
document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (text.length > 0 && !activeUI) {
    selectedText = text;
    fullContext = extractFullContext(selection);
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      selectionRect = range.getBoundingClientRect();
      showFloatingButton();
    }
  } else if (text.length === 0) {
    hideFloatingButton();
    fullContext = null;
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
    createFloatingUI(selectionRect, selectedText, fullContext);
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
async function createFloatingUI(rect, contextText, contextData = null) {
  try {
    // Use passed context data or fall back to global fullContext
    const currentContext = contextData || fullContext;
    

    if (activeUI) activeUI.remove();

    const container = document.createElement("div");
    container.id = "quickai-container";
    container.className = "quickai-container";
    
    // Store context data on the container for later use
    container.dataset.fullContext = JSON.stringify(currentContext || { selected: contextText, before: "", after: "", full: contextText });

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
                    <div class="quickai-header-buttons">
                        <button id="quickai-clear" class="quickai-clear" title="Clear conversation">🗑️</button>
                        <button id="quickai-close" class="quickai-close">&times;</button>
                    </div>
                </div>
                <div class="quickai-context">
                    <strong>Context:</strong> <span class="quickai-context-text">${escapeHtml(
                      contextText.substring(0, 100)
                    )}${contextText.length > 100 ? "..." : ""}</span>
                </div>
                <div id="quickai-conversation" class="quickai-conversation"></div>
                <div class="quickai-quick-actions">
                    <div class="quickai-actions-label">Quick Actions:</div>
                    <div class="quickai-actions-buttons">
                        <button class="quickai-action-btn" data-action="summarize">📝 Summarize</button>
                        <button class="quickai-action-btn" data-action="explain">💡 Explain</button>
                        <button class="quickai-action-btn" data-action="grammar">✏️ Fix Grammar</button>
                        <button class="quickai-action-btn" data-action="improve">✨ Improve</button>
                        <button class="quickai-action-btn" data-action="translate">🌐 Translate</button>
                    </div>
                </div>
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
    document.getElementById("quickai-clear").addEventListener("click", clearConversation);
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

    // Add quick action button listeners
    document.querySelectorAll(".quickai-action-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const action = e.target.dataset.action;
        executeQuickAction(action, contextText);
      });
    });

    // Focus on textarea
    document.getElementById("quickai-prompt").focus();

    console.log("Floating UI created successfully");
  } catch (error) {
    console.error("Error creating floating UI:", error);
    activeUI = null;
  }
}

// Execute quick action with predefined prompt
async function executeQuickAction(action, contextText) {
  const actionPrompts = {
    summarize: "Please provide a concise summary of the following text:",
    explain: "Please explain the following text in simple, easy-to-understand terms:",
    grammar: "Please fix any grammar, spelling, or punctuation mistakes in the following text. Return the corrected version:",
    improve: "Please improve the writing style of the following text while maintaining its meaning. Make it clearer and more engaging:",
    translate: "Please translate the following text to English (or to Spanish if it's already in English):"
  };

  const prompt = actionPrompts[action];
  if (!prompt) return;

  // Programmatically submit the query
  submitQueryWithPrompt(contextText, prompt);
}

// Submit query to AI
async function submitQuery(contextText) {
  const prompt = document.getElementById("quickai-prompt").value.trim();
  if (!prompt) return;
  
  submitQueryWithPrompt(contextText, prompt);
}

// Submit query with a specific prompt
async function submitQueryWithPrompt(contextText, prompt) {
  const model = document.getElementById("quickai-model").value;
  const conversationArea = document.getElementById("quickai-conversation");
  const submitBtn = document.getElementById("quickai-submit");
  const promptInput = document.getElementById("quickai-prompt");

  // Add user message to conversation
  const userMessage = document.createElement("div");
  userMessage.className = "quickai-message quickai-user-message";
  userMessage.innerHTML = `<div class="quickai-message-content">${escapeHtml(prompt)}</div>`;
  conversationArea.appendChild(userMessage);

  // Clear input only if it matches the submitted prompt
  if (promptInput && promptInput.value === prompt) {
    promptInput.value = "";
  }

  // Add AI message container with loading state
  const aiMessage = document.createElement("div");
  aiMessage.className = "quickai-message quickai-ai-message";
  aiMessage.id = `ai-message-${Date.now()}`;
  aiMessage.innerHTML = '<div class="quickai-message-content"><div class="quickai-loader"></div></div>';
  conversationArea.appendChild(aiMessage);

  // Scroll to bottom
  conversationArea.scrollTop = conversationArea.scrollHeight;

  // Store message ID for streaming updates
  const currentMessageId = aiMessage.id;

  submitBtn.disabled = true;
  submitBtn.textContent = "Processing...";
  
  // Disable all quick action buttons during processing
  document.querySelectorAll(".quickai-action-btn").forEach(btn => {
    btn.disabled = true;
  });

  // Get stored context from the container
  let storedContext;
  try {
    const container = document.getElementById("quickai-container");
    storedContext = container?.dataset.fullContext ? JSON.parse(container.dataset.fullContext) : null;
  } catch (e) {
    console.error("Error parsing stored context:", e);
    storedContext = null;
  }
  
  // Send to service worker with full context
  const contextToSend = storedContext || fullContext || { selected: contextText, before: "", after: "", full: contextText };
  chrome.runtime.sendMessage({
    type: "queryAI",
    context: contextText,
    fullContext: contextToSend,
    prompt: prompt,
    model: model,
    messageId: currentMessageId, // Pass message ID for targeted updates
  });
}

// Handle streaming responses
chrome.runtime.onMessage.addListener((message) => {
  const submitBtn = document.getElementById("quickai-submit");
  const conversationArea = document.getElementById("quickai-conversation");

  if (!conversationArea) return;

  // Find the target AI message
  const aiMessage = document.getElementById(message.messageId);
  if (!aiMessage) return;

  const messageContent = aiMessage.querySelector(".quickai-message-content");
  if (!messageContent) return;

  switch (message.type) {
    case "streamStart":
      messageContent.innerHTML = "";
      messageContent.dataset.fullResponse = "";
      break;

    case "streamChunk":
      messageContent.innerHTML += message.content;
      messageContent.dataset.fullResponse =
        (messageContent.dataset.fullResponse || "") + message.rawContent;
      conversationArea.scrollTop = conversationArea.scrollHeight;
      break;

    case "streamEnd":
      // Add copy button
      const copyBtn = document.createElement("button");
      copyBtn.className = "quickai-copy-btn";
      copyBtn.innerHTML = "📋 Copy";
      copyBtn.onclick = () => copyResponse(messageContent.dataset.fullResponse);
      messageContent.appendChild(copyBtn);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit";
      }
      
      // Re-enable quick action buttons
      document.querySelectorAll(".quickai-action-btn").forEach(btn => {
        btn.disabled = false;
      });
      
      // Focus back on input for next message
      const promptInput = document.getElementById("quickai-prompt");
      if (promptInput) promptInput.focus();
      break;

    case "streamError":
      messageContent.innerHTML = `<div class="quickai-error">Error: ${escapeHtml(
        message.error
      )}</div>`;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit";
      }
      
      // Re-enable quick action buttons on error
      document.querySelectorAll(".quickai-action-btn").forEach(btn => {
        btn.disabled = false;
      });
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
      // Extract full context from current selection
      fullContext = extractFullContext(selection);
    } else {
      // No selection context available
      fullContext = null;
    }

    hideFloatingButton();
    createFloatingUI(rect, message.text, fullContext);
    sendResponse({ success: true });
  }
});

// Close UI
function closeUI() {
  if (activeUI) {
    activeUI.remove();
    activeUI = null;
    // Clear conversation history when closing
    conversationHistory = [];
  }
  // Don't clear fullContext here - keep it until new selection
}

// Clear conversation
function clearConversation() {
  const conversationArea = document.getElementById("quickai-conversation");
  if (conversationArea) {
    conversationArea.innerHTML = "";
    conversationHistory = [];
    
    // Focus back on input
    const promptInput = document.getElementById("quickai-prompt");
    if (promptInput) promptInput.focus();
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
