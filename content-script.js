let activeUI = null;
let floatingButton = null;
let selectedText = "";
let selectionRect = null;
let fullContext = null;
let conversationHistory = []; // Track conversation messages
let originalSelection = null; // Store the original selection range
let editableElement = null; // Store reference to editable element

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

// Check if element is editable
function isEditableElement(element) {
  if (!element) return false;
  
  // Check for textarea or text input
  if (element.tagName === 'TEXTAREA' || 
      (element.tagName === 'INPUT' && (element.type === 'text' || element.type === 'email' || element.type === 'search'))) {
    return true;
  }
  
  // Check for contenteditable
  if (element.contentEditable === 'true' || element.isContentEditable) {
    return true;
  }
  
  // Check parent elements for contenteditable
  let parent = element.parentElement;
  while (parent) {
    if (parent.contentEditable === 'true' || parent.isContentEditable) {
      return true;
    }
    parent = parent.parentElement;
  }
  
  // Special handling for Gmail compose area
  if (element.getAttribute('role') === 'textbox' || 
      element.getAttribute('g_editable') === 'true' ||
      element.classList.contains('editable')) {
    return true;
  }
  
  // Special handling for Google Docs
  if (element.classList.contains('kix-page-content-wrapper') ||
      element.querySelector('.kix-page-content-wrapper') ||
      element.closest('.kix-page')) {
    return true;
  }
  
  return false;
}

// Get the editable container for a selection
function getEditableContainer(selection) {
  if (!selection || selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
  
  // Check if the element itself is editable
  if (isEditableElement(element)) {
    return element;
  }
  
  // Walk up the DOM tree to find editable parent
  let parent = element.parentElement;
  while (parent) {
    if (isEditableElement(parent)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  
  return null;
}

// Find the closest editable element to the current position
function findNearestEditableElement(rect) {
  // Get all standard editable elements
  let editables = Array.from(document.querySelectorAll(
    'textarea, input[type="text"], input[type="email"], input[type="search"], [contenteditable="true"], [role="textbox"], [g_editable="true"], .editable'
  ));
  
  // Special handling for Gmail
  const gmailCompose = document.querySelector('div[g_editable="true"]') || 
                      document.querySelector('div[role="textbox"]') ||
                      document.querySelector('div.editable');
  if (gmailCompose && !editables.includes(gmailCompose)) {
    editables.push(gmailCompose);
  }
  
  // Special handling for Google Docs
  const docsCanvas = document.querySelector('.kix-page-canvas') || 
                    document.querySelector('.kix-page');
  if (docsCanvas && !editables.includes(docsCanvas)) {
    editables.push(docsCanvas);
  }
  
  if (editables.length === 0) return null;
  
  // Filter out hidden or zero-size elements
  editables = editables.filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  
  if (editables.length === 0) return null;
  if (editables.length === 1) return editables[0];
  
  // Find the closest one to our UI position
  let closest = null;
  let minDistance = Infinity;
  
  const uiCenterX = rect.left + (rect.right - rect.left) / 2;
  const uiCenterY = rect.top + (rect.bottom - rect.top) / 2;
  
  editables.forEach(element => {
    const elemRect = element.getBoundingClientRect();
    const elemCenterX = elemRect.left + elemRect.width / 2;
    const elemCenterY = elemRect.top + elemRect.height / 2;
    
    const distance = Math.sqrt(
      Math.pow(uiCenterX - elemCenterX, 2) + 
      Math.pow(uiCenterY - elemCenterY, 2)
    );
    
    if (distance < minDistance) {
      minDistance = distance;
      closest = element;
    }
  });
  
  return closest;
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
      
      // Store the original selection range and check if it's editable
      originalSelection = range.cloneRange();
      editableElement = getEditableContainer(selection);
      
      showFloatingButton();
    }
  } else if (text.length === 0) {
    hideFloatingButton();
    fullContext = null;
    originalSelection = null;
    editableElement = null;
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
    createFloatingUI(selectionRect, selectedText, fullContext, editableElement);
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
async function createFloatingUI(rect, contextText, contextData = null, editable = null) {
  try {
    // Use passed context data or fall back to global fullContext
    const currentContext = contextData || fullContext;
    

    if (activeUI) activeUI.remove();

    const container = document.createElement("div");
    container.id = "quickai-container";
    container.className = "quickai-container";
    
    // Store context data on the container for later use
    container.dataset.fullContext = JSON.stringify(currentContext || { selected: contextText, before: "", after: "", full: contextText });
    
    // Store editable element reference on the container
    // If no editable element from selection, try to find nearest one
    const editableToUse = editable || editableElement || findNearestEditableElement(rect);
    if (editableToUse) {
      container.dataset.isEditable = "true";
      // Update global reference if we found one
      if (!editableElement) {
        editableElement = editableToUse;
      }
    }

    // Position near selected text
    const top = window.scrollY + rect.bottom + 10;
    const left = window.scrollX + rect.left;

    container.style.top = `${top}px`;
    container.style.left = `${left}px`;

    // Load available models and last selected model
    const models = await getModels();
    let lastModel = null;
    try {
      const result = await chrome.storage.sync.get("lastModel");
      lastModel = result.lastModel;
    } catch (error) {
      console.warn("Could not access chrome.storage:", error);
    }
    const defaultModel = lastModel || models[0]?.id || "google/gemini-2.5-flash";

    console.log("Models loaded:", models.length, "Last model:", defaultModel);

    container.innerHTML = `
            <div class="quickai-gradient-border"></div>
            <div class="quickai-content">
                <div class="quickai-header">
                    <span class="quickai-title">QuickAI</span>
                    <div class="quickai-header-buttons">
                        <button id="quickai-expand" class="quickai-expand" title="Expand">⬜</button>
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
    document.getElementById("quickai-expand").addEventListener("click", toggleExpand);
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
      try {
        chrome.storage.sync.set({ lastModel: e.target.value });
      } catch (error) {
        console.warn("Could not save model selection:", error);
      }
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
  
  try {
    chrome.runtime.sendMessage({
      type: "queryAI",
      context: contextText,
      fullContext: contextToSend,
      prompt: prompt,
      model: model,
      messageId: currentMessageId, // Pass message ID for targeted updates
    });
  } catch (error) {
    console.error("Failed to send message to service worker:", error);
    const messageContent = aiMessage.querySelector(".quickai-message-content");
    if (messageContent) {
      messageContent.innerHTML = '<div class="quickai-error">Failed to connect to QuickAI service. Please refresh the page and try again.</div>';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
    // Re-enable quick action buttons on error
    document.querySelectorAll(".quickai-action-btn").forEach(btn => {
      btn.disabled = false;
    });
  }
}

// Handle streaming responses
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
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

      // Add replace button if the selection was in an editable element
      const container = document.getElementById("quickai-container");
      if (container && container.dataset.isEditable === "true" && editableElement) {
        const replaceBtn = document.createElement("button");
        replaceBtn.className = "quickai-replace-btn";
        replaceBtn.innerHTML = "↔️ Replace";
        replaceBtn.onclick = () => replaceSelectedText(messageContent.dataset.fullResponse);
        messageContent.appendChild(replaceBtn);
      }

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
}

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

// Replace selected text with AI response
async function replaceSelectedText(newText) {
  try {
    if (!editableElement) {
      throw new Error("No editable element found");
    }

    // For textarea and input elements
    if (editableElement.tagName === 'TEXTAREA' || editableElement.tagName === 'INPUT') {
      editableElement.focus();
      
      // If we have a selection and selected text
      if (originalSelection && selectedText) {
        // Try to get the stored selection range from the original selection
        let start, end;
        
        if (originalSelection && originalSelection.startContainer === editableElement.firstChild) {
          // If we have the original selection within the element
          start = originalSelection.startOffset;
          end = originalSelection.endOffset;
        } else {
          // Fallback: search for the selected text in the element
          const elementText = editableElement.value;
          const searchIndex = elementText.indexOf(selectedText);
          
          if (searchIndex !== -1) {
            start = searchIndex;
            end = searchIndex + selectedText.length;
          } else {
            // No selected text found, append to current content
            start = editableElement.value.length;
            end = start;
            if (editableElement.value && !editableElement.value.endsWith(' ')) {
              newText = ' ' + newText;
            }
          }
        }
        
        // Use setRangeText to replace and maintain undo history
        editableElement.setRangeText(newText, start, end, 'end');
      } else {
        // No selection - append to existing content or replace all
        if (editableElement.value.trim()) {
          // If there's existing content, append
          const separator = editableElement.value.endsWith(' ') ? '' : ' ';
          editableElement.value += separator + newText;
        } else {
          // If empty, just set the value
          editableElement.value = newText;
        }
      }
      
      // Dispatch input event to trigger any listeners
      editableElement.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Show success feedback
      showReplacementFeedback(true);
      
    } else if (editableElement.isContentEditable || editableElement.contentEditable === 'true' || 
               editableElement.getAttribute('role') === 'textbox' || 
               editableElement.getAttribute('g_editable') === 'true') {
      // For contenteditable elements (including Gmail and Google Docs)
      editableElement.focus();
      
      // Special handling for Google Docs
      if (editableElement.classList.contains('kix-page') || editableElement.closest('.kix-page')) {
        // Google Docs requires special handling - just copy to clipboard and notify user
        await navigator.clipboard.writeText(newText);
        showReplacementFeedback(true, "Copied to clipboard! Press Ctrl+V to paste in Google Docs");
        return;
      }
      
      const selection = window.getSelection();
      
      // Special handling for Gmail
      if (editableElement.getAttribute('g_editable') === 'true' || 
          editableElement.getAttribute('role') === 'textbox') {
        // Gmail-specific approach
        if (originalSelection && selectedText) {
          selection.removeAllRanges();
          selection.addRange(originalSelection);
          
          // Try multiple methods for Gmail compatibility
          if (!document.execCommand('insertText', false, newText)) {
            // Fallback: dispatch input events
            const inputEvent = new InputEvent('beforeinput', {
              inputType: 'insertText',
              data: newText,
              bubbles: true,
              cancelable: true
            });
            editableElement.dispatchEvent(inputEvent);
          }
        } else {
          // No selection - append to end
          editableElement.focus();
          selection.selectAllChildren(editableElement);
          selection.collapseToEnd();
          
          const textToInsert = editableElement.textContent.trim() && !editableElement.textContent.endsWith(' ') 
            ? ' ' + newText 
            : newText;
          document.execCommand('insertText', false, textToInsert);
        }
      } else {
        // Standard contenteditable handling
        if (originalSelection && selectedText) {
          selection.removeAllRanges();
          selection.addRange(originalSelection);
          document.execCommand('insertText', false, newText);
        } else {
          // No selection - place cursor at end and insert
          selection.removeAllRanges();
          const range = document.createRange();
          
          if (editableElement.lastChild) {
            range.selectNodeContents(editableElement.lastChild);
            range.collapse(false);
          } else {
            range.selectNodeContents(editableElement);
            range.collapse(false);
          }
          
          selection.addRange(range);
          
          const textToInsert = editableElement.textContent.trim() && !editableElement.textContent.endsWith(' ') 
            ? ' ' + newText 
            : newText;
          document.execCommand('insertText', false, textToInsert);
        }
      }
      
      // Show success feedback
      showReplacementFeedback(true);
    }
  } catch (error) {
    console.error("Failed to replace text:", error);
    showReplacementFeedback(false);
  }
}

// Show visual feedback after replacement
function showReplacementFeedback(success, customMessage = null) {
  const replaceBtn = document.querySelector(".quickai-replace-btn");
  if (!replaceBtn) return;
  
  const originalText = replaceBtn.innerHTML;
  
  if (success) {
    if (customMessage) {
      // For Google Docs special case
      replaceBtn.innerHTML = "📋 Copied!";
      replaceBtn.title = customMessage;
      replaceBtn.style.background = "#2196F3";
    } else {
      replaceBtn.innerHTML = "✅ Replaced!";
      replaceBtn.style.background = "#4caf50";
    }
    
    setTimeout(() => {
      replaceBtn.innerHTML = originalText;
      replaceBtn.style.background = "";
      replaceBtn.title = "";
    }, 3000);
  } else {
    replaceBtn.innerHTML = "❌ Failed";
    replaceBtn.style.background = "#f44336";
    
    setTimeout(() => {
      replaceBtn.innerHTML = originalText;
      replaceBtn.style.background = "";
    }, 2000);
  }
}

// Handle context menu trigger
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
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
      // Store the original selection and check if editable
      originalSelection = range.cloneRange();
      editableElement = getEditableContainer(selection);
    } else {
      // No selection context available
      fullContext = null;
      originalSelection = null;
      editableElement = null;
    }

    hideFloatingButton();
    createFloatingUI(rect, message.text, fullContext, editableElement);
    sendResponse({ success: true });
    }
  });
}

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

// Toggle expand/collapse
function toggleExpand() {
  const container = document.getElementById("quickai-container");
  const expandBtn = document.getElementById("quickai-expand");
  
  if (container.classList.contains("quickai-expanded")) {
    container.classList.remove("quickai-expanded");
    expandBtn.innerHTML = "⬜";
    expandBtn.title = "Expand";
  } else {
    container.classList.add("quickai-expanded");
    expandBtn.innerHTML = "⬛";
    expandBtn.title = "Collapse";
  }
}

// Get available models
async function getModels() {
  try {
    // Dynamically load models from models.js
    let modelsUrl;
    try {
      modelsUrl = chrome.runtime.getURL("models.js");
    } catch (error) {
      console.warn("chrome.runtime not available, using fallback models");
      return getFallbackModels();
    }
    
    const response = await fetch(modelsUrl);
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
    return getFallbackModels();
  }
}

// Get fallback models when chrome APIs are not available
function getFallbackModels() {
  return [
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "anthropic/claude-sonnet-4", name: "Claude 4 Sonnet" },
    { id: "anthropic/claude-opus-4", name: "Claude 4 Opus" },
    { id: "openai/gpt-4.1", name: "GPT-4.1" },
    { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
  ];
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

// Listen for Ctrl+C to show question mark with clipboard content
document.addEventListener("keydown", async (e) => {
  if (e.ctrlKey && e.key === 'c') {
    // Give the browser time to copy to clipboard
    setTimeout(async () => {
      try {
        // Read clipboard content
        const clipboardText = await navigator.clipboard.readText();
        
        if (clipboardText && clipboardText.trim()) {
          // Close any existing UI
          closeUI();
          
          // Set the clipboard text as selected text
          selectedText = clipboardText.trim();
          fullContext = { selected: selectedText, before: "", after: "" };
          conversationHistory = [];
          
          // Get cursor position to show the floating button
          const mouseX = window.innerWidth / 2;
          const mouseY = window.innerHeight / 2;
          
          // Create a fake selection rect at center of screen
          selectionRect = {
            left: mouseX - 50,
            top: mouseY - 50,
            right: mouseX + 50,
            bottom: mouseY + 50,
            width: 100,
            height: 100
          };
          
          // Show the floating button
          showFloatingButton();
        }
      } catch (error) {
        console.error("Failed to read clipboard:", error);
      }
    }, 100);
  }
});
