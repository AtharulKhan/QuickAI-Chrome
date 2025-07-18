let activeUI = null;
let floatingButton = null;
let googleButton = null;
let screenshotButton = null;
let selectedText = "";
let selectionRect = null;
let fullContext = null;
let conversationHistory = []; // Track conversation messages
let originalSelection = null; // Store the original selection range
let editableElement = null; // Store reference to editable element
let hoveredLink = null; // Track currently hovered link
let linkHoverTimeout = null; // Timeout for link hover delay
let currentLinkUrl = null; // Store current link URL
let googleSearchResults = []; // Store Google search results
let googleScrapedContent = new Map(); // Store scraped content from Google results

console.log("QuickAI content script loaded on:", window.location.href);

// Extract context paragraphs before and after selection
function extractFullContext(selection) {
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();

  // Get the common ancestor container
  const container = range.commonAncestorContainer;
  const parentElement =
    container.nodeType === Node.TEXT_NODE ? container.parentElement : container;

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
    before: beforeBlocks.join("\n\n"),
    after: afterBlocks.join("\n\n"),
    full: [...beforeBlocks, selectedText, ...afterBlocks].join("\n\n"),
  };

  return result;
}

// Check if element is block-level
function isBlockElement(element) {
  const blockTags = [
    "P",
    "DIV",
    "SECTION",
    "ARTICLE",
    "BLOCKQUOTE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "TD",
    "TH",
  ];
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

// Extract full page content for AI context
function extractFullPageContent() {
  try {
    // Get page metadata
    const pageTitle = document.title || "";
    const pageUrl = window.location.href;

    // Try to find the main content area
    const mainContentSelectors = [
      "main",
      "article",
      '[role="main"]',
      "#main",
      ".main",
      "#content",
      ".content",
      "#article",
      ".article",
      ".post",
      ".entry-content",
      ".page-content",
    ];

    let mainContent = null;
    for (const selector of mainContentSelectors) {
      mainContent = document.querySelector(selector);
      if (mainContent) break;
    }

    // If no main content found, use body
    if (!mainContent) {
      mainContent = document.body;
    }

    // Clone the content to avoid modifying the original
    const contentClone = mainContent.cloneNode(true);

    // Remove unwanted elements
    const unwantedSelectors = [
      "script",
      "style",
      "noscript",
      "iframe",
      "object",
      "embed",
      "nav",
      "header",
      "footer",
      ".sidebar",
      ".advertisement",
      ".ads",
      "#quickai-container",
      "#quickai-trigger-button",
    ];

    unwantedSelectors.forEach((selector) => {
      contentClone.querySelectorAll(selector).forEach((el) => el.remove());
    });

    // Extract text content
    let textContent = "";
    const walker = document.createTreeWalker(
      contentClone,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          // Skip whitespace-only nodes
          if (node.textContent.trim().length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    const textParts = [];
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text) {
        textParts.push(text);
      }
    }

    textContent = textParts.join(" ");

    // Limit content length to avoid token limits (approximately 10,000 characters)
    const maxLength = 10000;
    if (textContent.length > maxLength) {
      textContent =
        textContent.substring(0, maxLength) + "... [content truncated]";
    }

    return {
      title: pageTitle,
      url: pageUrl,
      content: textContent,
      truncated: textContent.length > maxLength,
    };
  } catch (error) {
    console.error("Error extracting page content:", error);
    return null;
  }
}

// Check if element is editable
function isEditableElement(element) {
  if (!element) return false;

  // Check for textarea or text input
  if (
    element.tagName === "TEXTAREA" ||
    (element.tagName === "INPUT" &&
      (element.type === "text" ||
        element.type === "email" ||
        element.type === "search"))
  ) {
    return true;
  }

  // Check for contenteditable
  if (element.contentEditable === "true" || element.isContentEditable) {
    return true;
  }

  // Check parent elements for contenteditable
  let parent = element.parentElement;
  while (parent) {
    if (parent.contentEditable === "true" || parent.isContentEditable) {
      return true;
    }
    parent = parent.parentElement;
  }

  // Special handling for Gmail compose area
  if (
    element.getAttribute("role") === "textbox" ||
    element.getAttribute("g_editable") === "true" ||
    element.classList.contains("editable")
  ) {
    return true;
  }

  // Special handling for Google Docs
  if (
    element.classList.contains("kix-page-content-wrapper") ||
    element.querySelector(".kix-page-content-wrapper") ||
    element.closest(".kix-page")
  ) {
    return true;
  }

  return false;
}

// Get the editable container for a selection
function getEditableContainer(selection) {
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element =
    container.nodeType === Node.TEXT_NODE ? container.parentElement : container;

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
  let editables = Array.from(
    document.querySelectorAll(
      'textarea, input[type="text"], input[type="email"], input[type="search"], [contenteditable="true"], [role="textbox"], [g_editable="true"], .editable'
    )
  );

  // Special handling for Gmail
  const gmailCompose =
    document.querySelector('div[g_editable="true"]') ||
    document.querySelector('div[role="textbox"]') ||
    document.querySelector("div.editable");
  if (gmailCompose && !editables.includes(gmailCompose)) {
    editables.push(gmailCompose);
  }

  // Special handling for Google Docs
  const docsCanvas =
    document.querySelector(".kix-page-canvas") ||
    document.querySelector(".kix-page");
  if (docsCanvas && !editables.includes(docsCanvas)) {
    editables.push(docsCanvas);
  }

  if (editables.length === 0) return null;

  // Filter out hidden or zero-size elements
  editables = editables.filter((el) => {
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

  editables.forEach((element) => {
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
function showFloatingButton(type = "text", rect = null, data = null) {
  if (floatingButton) return;

  // Create QuickAI button
  floatingButton = document.createElement("button");
  floatingButton.id = "quickai-trigger-button";
  floatingButton.className = type === "link" ? "quickai-link-button" : "";
  floatingButton.innerHTML = type === "link" ? "🔗" : "?";
  floatingButton.title =
    type === "link" ? "Summarize this link" : "Ask QuickAI";
  floatingButton.dataset.type = type;

  // Position near selection or link
  const targetRect = rect || selectionRect;
  const top = window.scrollY + targetRect.bottom + 5;
  const left = window.scrollX + targetRect.left;

  floatingButton.style.top = `${top}px`;
  floatingButton.style.left = `${left}px`;

  // Add click handler
  floatingButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideFloatingButton();

    if (type === "link" && data) {
      createFloatingUIForLink(targetRect, data.url, data.text);
    } else {
      createFloatingUI(targetRect, selectedText, fullContext, editableElement);
    }
  });

  document.body.appendChild(floatingButton);

  // Only show Google button for text selection
  if (type === "text") {
    googleButton = document.createElement("button");
    googleButton.id = "quickai-google-button";
    googleButton.innerHTML = "G";
    googleButton.title = "Search on Google";

    // Position Google button next to QuickAI button
    googleButton.style.top = `${top}px`;
    googleButton.style.left = `${left + 30}px`; // 30px to the right

    // Add click handler for Google search
    googleButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideFloatingButton();
      initiateGoogleSearch(targetRect, selectedText);
    });

    document.body.appendChild(googleButton);

    // Add screenshot button
    screenshotButton = document.createElement("button");
    screenshotButton.id = "quickai-screenshot-button";
    screenshotButton.innerHTML = "i";
    screenshotButton.title = "Take screenshot and analyze";

    // Position screenshot button next to Google button
    screenshotButton.style.top = `${top}px`;
    screenshotButton.style.left = `${left + 60}px`; // 60px to the right

    // Add click handler for screenshot
    screenshotButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideFloatingButton();
      initiateScreenshotCapture(targetRect, selectedText);
    });

    document.body.appendChild(screenshotButton);

    // Add combined Google + Screenshot button
    const googleScreenshotButton = document.createElement("button");
    googleScreenshotButton.id = "quickai-google-screenshot-button";
    googleScreenshotButton.innerHTML = "ii";
    googleScreenshotButton.title = "Search Google and screenshot top 5 results";
    // Position combined button next to screenshot button
    googleScreenshotButton.style.top = `${top}px`;
    googleScreenshotButton.style.left = `${left + 90}px`; // 90px to the right
    // Add click handler for combined action
    googleScreenshotButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideFloatingButton();
      initiateGoogleSearchWithScreenshots(targetRect, selectedText);
    });
    document.body.appendChild(googleScreenshotButton);
  }
}

// Hide floating button
function hideFloatingButton() {
  if (floatingButton) {
    floatingButton.remove();
    floatingButton = null;
  }
  if (googleButton) {
    googleButton.remove();
    googleButton = null;
  }
  if (screenshotButton) {
    screenshotButton.remove();
    screenshotButton = null;
  }
  const googleScreenshotButton = document.getElementById(
    "quickai-google-screenshot-button"
  );
  if (googleScreenshotButton) {
    googleScreenshotButton.remove();
  }
}

// Create the floating UI
async function createFloatingUI(
  rect,
  contextText,
  contextData = null,
  editable = null
) {
  try {
    // Use passed context data or fall back to global fullContext
    const currentContext = contextData || fullContext;

    if (activeUI) activeUI.remove();

    const container = document.createElement("div");
    container.id = "quickai-container";
    container.className = "quickai-container";

    // Store context data on the container for later use
    container.dataset.fullContext = JSON.stringify(
      currentContext || {
        selected: contextText,
        before: "",
        after: "",
        full: contextText,
      }
    );

    // Store editable element reference on the container
    // If no editable element from selection, try to find nearest one
    const editableToUse =
      editable || editableElement || findNearestEditableElement(rect);
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
    const defaultModel =
      lastModel || models[0]?.id || "google/gemini-2.5-flash";

    console.log("Models loaded:", models.length, "Last model:", defaultModel);

    container.innerHTML = `
            <div class="quickai-gradient-border"></div>
            <div class="quickai-content">
                <div class="quickai-header">
                    <span class="quickai-title">QuickAI</span>
                    <div class="quickai-header-buttons">
                        <button id="quickai-tab-selector" class="quickai-tab-selector-btn" title="Include tab content">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="2" y="3" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
                                <rect x="9" y="3" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
                                <rect x="2" y="9" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
                                <rect x="9" y="9" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
                            </svg>
                        </button>
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
                <div class="quickai-page-context-toggle">
                    <label class="quickai-toggle-label">
                        <input type="checkbox" id="quickai-include-page-context" class="quickai-toggle-checkbox">
                        <span class="quickai-toggle-slider"></span>
                        <span class="quickai-toggle-text">Include Full Page Context</span>
                    </label>
                    <span id="quickai-page-context-indicator" class="quickai-page-context-indicator"></span>
                </div>
                <div id="quickai-context-indicators" class="quickai-context-indicators" style="display: none;">
                    <span class="quickai-context-indicator-label">Context:</span>
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
                    <div class="quickai-textarea-wrapper">
                        <textarea id="quickai-prompt" class="quickai-prompt" placeholder="Ask a question about the selected text..." rows="3"></textarea>
                        <button id="quickai-voice" class="quickai-voice-btn" title="Voice to text with AI cleanup" aria-label="Voice to text with AI cleanup">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8 11C9.66 11 11 9.66 11 8V4C11 2.34 9.66 1 8 1C6.34 1 5 2.34 5 4V8C5 9.66 6.34 11 8 11Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M13 8C13 10.76 10.76 13 8 13C5.24 13 3 10.76 3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M8 13V15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
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
      .getElementById("quickai-clear")
      .addEventListener("click", clearConversation);
    document
      .getElementById("quickai-expand")
      .addEventListener("click", toggleExpand);
    document
      .getElementById("quickai-submit")
      .addEventListener("click", () => submitQuery(contextText));
    const promptTextarea = document.getElementById("quickai-prompt");
    promptTextarea.addEventListener("keydown", async (e) => {
      // Handle template selector navigation first
      if (templateSelectorActive) {
        const handled = await handleTemplateSelectorKeyboard(e, promptTextarea);
        if (handled) return;
      }

      if (e.key === "Enter" && e.ctrlKey) {
        submitQuery(contextText);
      }
    });

    // Add input event listener for @ detection
    promptTextarea.addEventListener("input", async (e) => {
      const cursorPos = promptTextarea.selectionStart;
      const textBefore = promptTextarea.value.substring(0, cursorPos);

      // Check if @ was just typed
      const atSymbolIndex = textBefore.lastIndexOf("@");
      console.log(
        "QuickAI: Input detected - cursor:",
        cursorPos,
        "atSymbolIndex:",
        atSymbolIndex,
        "text:",
        textBefore
      );

      if (atSymbolIndex !== -1 && atSymbolIndex === cursorPos - 1) {
        // @ was just typed, show template selector
        templateSelectorActive = true;
        templateSearchQuery = "";
        selectedTemplateIndex = 0;

        const { promptTemplates = [] } = await chrome.storage.sync.get(
          "promptTemplates"
        );
        console.log("Loading templates:", promptTemplates);

        // If no templates exist, show a helpful message
        if (promptTemplates.length === 0) {
          // Remove any existing selector first
          const existingSelector = document.getElementById(
            "quickai-template-selector"
          );
          if (existingSelector) existingSelector.remove();

          const noTemplatesDiv = document.createElement("div");
          noTemplatesDiv.id = "quickai-template-selector";
          noTemplatesDiv.className = "quickai-template-selector";
          noTemplatesDiv.style.cssText = `
              position: fixed;
              top: ${promptTextarea.getBoundingClientRect().top - 100}px;
              left: ${promptTextarea.getBoundingClientRect().left}px;
              padding: 12px;
              background: white;
              border: 1px solid #e0e0e0;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
              z-index: 2147483650;
              font-size: 13px;
              color: #666;
            `;
          noTemplatesDiv.textContent =
            "No templates found. Add templates in the extension options.";
          document.body.appendChild(noTemplatesDiv);
          console.log("QuickAI: Showing no templates message");

          // Remove after 3 seconds
          setTimeout(() => {
            noTemplatesDiv.remove();
            closeTemplateSelector();
          }, 3000);
        } else {
          createTemplateSelector(promptTextarea, promptTemplates);
        }
      } else if (templateSelectorActive && atSymbolIndex !== -1) {
        // Update search query if @ is still present
        templateSearchQuery = textBefore.substring(atSymbolIndex + 1);
        selectedTemplateIndex = 0;

        const { promptTemplates = [] } = await chrome.storage.sync.get(
          "promptTemplates"
        );
        createTemplateSelector(
          promptTextarea,
          promptTemplates,
          templateSearchQuery
        );
      } else if (templateSelectorActive) {
        // @ was deleted, close selector
        closeTemplateSelector();
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
    document.querySelectorAll(".quickai-action-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = e.target.dataset.action;
        executeQuickAction(action, contextText);
      });
    });

    // Add voice button listener
    document.getElementById("quickai-voice").addEventListener("click", () => {
      startVoiceRecognition();
    });

    // Add tab selector button listener
    document
      .getElementById("quickai-tab-selector")
      .addEventListener("click", () => {
        openTabSelector();
      });

    // Add page context toggle listener
    const pageContextToggle = document.getElementById(
      "quickai-include-page-context"
    );
    const pageContextIndicator = document.getElementById(
      "quickai-page-context-indicator"
    );

    // Load saved state
    try {
      chrome.storage.sync.get("includePageContext", (result) => {
        if (result.includePageContext) {
          pageContextToggle.checked = true;
          updatePageContextIndicator(true);
        }
      });
    } catch (error) {
      console.warn("Could not load page context preference:", error);
    }

    pageContextToggle.addEventListener("change", async (e) => {
      const includePageContext = e.target.checked;

      // Save preference
      try {
        chrome.storage.sync.set({ includePageContext });
      } catch (error) {
        console.warn("Could not save page context preference:", error);
      }

      // Update indicator
      updatePageContextIndicator(includePageContext);

      // If enabled, extract and cache page content
      if (includePageContext) {
        pageContextIndicator.textContent = "Extracting page content...";
        const pageContent = extractFullPageContent();
        if (pageContent) {
          container.dataset.pageContent = JSON.stringify(pageContent);
          pageContextIndicator.textContent = pageContent.truncated
            ? "Page content loaded (truncated)"
            : "Page content loaded";
        } else {
          pageContextIndicator.textContent = "Failed to extract page content";
        }
      }
    });

    function updatePageContextIndicator(enabled) {
      if (enabled) {
        pageContextIndicator.textContent = "Page context will be included";
        pageContextIndicator.style.color = "#4caf50";
      } else {
        pageContextIndicator.textContent = "";
      }
    }

    // Focus on textarea
    document.getElementById("quickai-prompt").focus();

    console.log("Floating UI created successfully");
  } catch (error) {
    console.error("Error creating floating UI:", error);
    activeUI = null;
  }
}

// Create floating UI for link summarization
async function createFloatingUIForLink(rect, linkUrl, linkText) {
  try {
    if (activeUI) activeUI.remove();

    const container = document.createElement("div");
    container.id = "quickai-container";
    container.className = "quickai-container";

    // Store link data on the container
    container.dataset.linkUrl = linkUrl;
    container.dataset.linkText = linkText;
    container.dataset.isLinkSummary = "true";

    // Position near link
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
    const defaultModel =
      lastModel || models[0]?.id || "google/gemini-2.5-flash";

    container.innerHTML = `
      <div class="quickai-gradient-border"></div>
      <div class="quickai-content">
        <div class="quickai-header">
          <span class="quickai-title">QuickAI - Link Summary</span>
          <div class="quickai-header-buttons">
            <button id="quickai-tab-selector" class="quickai-tab-selector-btn" title="Include tab content">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="3" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
                <rect x="9" y="3" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
                <rect x="2" y="9" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
                <rect x="9" y="9" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </button>
            <button id="quickai-expand" class="quickai-expand" title="Expand">⬜</button>
            <button id="quickai-clear" class="quickai-clear" title="Clear conversation">🗑️</button>
            <button id="quickai-close" class="quickai-close">&times;</button>
          </div>
        </div>
        <div class="quickai-context quickai-link-context">
          <strong>Link:</strong> <a href="${escapeHtml(
            linkUrl
          )}" target="_blank" class="quickai-context-link">${escapeHtml(
      linkText.length > 50 ? linkText.substring(0, 50) + "..." : linkText
    )}</a>
        </div>
        <div id="quickai-context-indicators" class="quickai-context-indicators" style="display: none;">
          <span class="quickai-context-indicator-label">Context:</span>
        </div>
        <div id="quickai-conversation" class="quickai-conversation">
          <div class="quickai-message quickai-ai-message">
            <div class="quickai-message-content">
              <div class="quickai-loader"></div>
            </div>
          </div>
        </div>
        <div class="quickai-input-area">
          <div class="quickai-textarea-wrapper">
            <textarea id="quickai-prompt" class="quickai-prompt" placeholder="Ask follow-up questions about this link..." rows="3"></textarea>
            <button id="quickai-voice" class="quickai-voice-btn" title="Voice to text with AI cleanup" aria-label="Voice to text with AI cleanup">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 11C9.66 11 11 9.66 11 8V4C11 2.34 9.66 1 8 1C6.34 1 5 2.34 5 4V8C5 9.66 6.34 11 8 11Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13 8C13 10.76 10.76 13 8 13C5.24 13 3 10.76 3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 13V15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
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
      .getElementById("quickai-clear")
      .addEventListener("click", clearConversation);
    document
      .getElementById("quickai-expand")
      .addEventListener("click", toggleExpand);
    document
      .getElementById("quickai-submit")
      .addEventListener("click", () => submitQueryForLink(linkUrl, linkText));
    const promptTextarea = document.getElementById("quickai-prompt");
    promptTextarea.addEventListener("keydown", async (e) => {
      // Handle template selector navigation first
      if (templateSelectorActive) {
        const handled = await handleTemplateSelectorKeyboard(e, promptTextarea);
        if (handled) return;
      }

      if (e.key === "Enter" && e.ctrlKey) {
        submitQueryForLink(linkUrl, linkText);
      }
    });

    // Add input event listener for @ detection
    promptTextarea.addEventListener("input", async (e) => {
      const cursorPos = promptTextarea.selectionStart;
      const textBefore = promptTextarea.value.substring(0, cursorPos);

      // Check if @ was just typed
      const atSymbolIndex = textBefore.lastIndexOf("@");
      console.log(
        "QuickAI: Input detected - cursor:",
        cursorPos,
        "atSymbolIndex:",
        atSymbolIndex,
        "text:",
        textBefore
      );

      if (atSymbolIndex !== -1 && atSymbolIndex === cursorPos - 1) {
        // @ was just typed, show template selector
        templateSelectorActive = true;
        templateSearchQuery = "";
        selectedTemplateIndex = 0;

        const { promptTemplates = [] } = await chrome.storage.sync.get(
          "promptTemplates"
        );
        console.log("Loading templates:", promptTemplates);

        // If no templates exist, show a helpful message
        if (promptTemplates.length === 0) {
          // Remove any existing selector first
          const existingSelector = document.getElementById(
            "quickai-template-selector"
          );
          if (existingSelector) existingSelector.remove();

          const noTemplatesDiv = document.createElement("div");
          noTemplatesDiv.id = "quickai-template-selector";
          noTemplatesDiv.className = "quickai-template-selector";
          noTemplatesDiv.style.cssText = `
              position: fixed;
              top: ${promptTextarea.getBoundingClientRect().top - 100}px;
              left: ${promptTextarea.getBoundingClientRect().left}px;
              padding: 12px;
              background: white;
              border: 1px solid #e0e0e0;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
              z-index: 2147483650;
              font-size: 13px;
              color: #666;
            `;
          noTemplatesDiv.textContent =
            "No templates found. Add templates in the extension options.";
          document.body.appendChild(noTemplatesDiv);
          console.log("QuickAI: Showing no templates message");

          // Remove after 3 seconds
          setTimeout(() => {
            noTemplatesDiv.remove();
            closeTemplateSelector();
          }, 3000);
        } else {
          createTemplateSelector(promptTextarea, promptTemplates);
        }
      } else if (templateSelectorActive && atSymbolIndex !== -1) {
        // Update search query if @ is still present
        templateSearchQuery = textBefore.substring(atSymbolIndex + 1);
        selectedTemplateIndex = 0;

        const { promptTemplates = [] } = await chrome.storage.sync.get(
          "promptTemplates"
        );
        createTemplateSelector(
          promptTextarea,
          promptTemplates,
          templateSearchQuery
        );
      } else if (templateSelectorActive) {
        // @ was deleted, close selector
        closeTemplateSelector();
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

    // Add voice button listener
    document.getElementById("quickai-voice").addEventListener("click", () => {
      startVoiceRecognition();
    });

    // Add tab selector button listener
    document
      .getElementById("quickai-tab-selector")
      .addEventListener("click", () => {
        openTabSelector();
      });

    // Automatically start summarizing the link
    summarizeLink(linkUrl, linkText, defaultModel);
  } catch (error) {
    console.error("Error creating link UI:", error);
    activeUI = null;
  }
}

// Scrape content from a link
async function scrapeLinkContent(linkUrl) {
  const debug = true; // Enable debug logging

  try {
    // Check if it's the same origin
    const linkOrigin = new URL(linkUrl).origin;
    const currentOrigin = window.location.origin;

    if (debug) {
      console.log("🔍 QuickAI Debug - Starting link scrape:", {
        linkUrl,
        linkOrigin,
        currentOrigin,
        isSameOrigin: linkOrigin === currentOrigin,
      });
    }

    if (linkOrigin === currentOrigin) {
      // Same origin - we can fetch directly
      if (debug)
        console.log("📡 QuickAI Debug - Attempting same-origin fetch...");

      const response = await fetch(linkUrl);

      if (debug) {
        console.log("📡 QuickAI Debug - Fetch response:", {
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get("content-type"),
          ok: response.ok,
        });
      }

      if (response.ok) {
        const html = await response.text();

        if (debug) {
          console.log("📄 QuickAI Debug - HTML fetched:", {
            htmlLength: html.length,
            htmlPreview: html.substring(0, 500) + "...",
          });
        }

        return extractContentFromPage(html, linkUrl, debug);
      }
    } else {
      // Different origin - try iframe approach
      if (debug)
        console.log(
          "🔒 QuickAI Debug - Cross-origin detected, trying iframe approach..."
        );
      return await scrapeViaIframe(linkUrl, debug);
    }
  } catch (error) {
    console.error("❌ QuickAI Debug - Error scraping link:", error);
    return null;
  }
}

// Extract content from HTML string
function extractContentFromPage(html, url, debug = false) {
  try {
    // Create a temporary container
    const container = document.createElement("div");
    container.innerHTML = html;

    // Extract metadata
    const titleEl = container.querySelector("title");
    const title = titleEl?.textContent || "";

    const metaDesc = container.querySelector('meta[name="description"]');
    const description = metaDesc?.content || "";

    if (debug) {
      console.log("🏷️ QuickAI Debug - Metadata extracted:", {
        title,
        description,
        url,
      });
    }

    // Remove unwanted elements
    const unwantedSelectors = [
      "script",
      "style",
      "nav",
      "header",
      "footer",
      "aside",
      ".sidebar",
      ".advertisement",
      ".ads",
      "#comments",
      ".comments",
      ".cookie",
      ".modal",
    ];

    let removedCount = 0;
    unwantedSelectors.forEach((selector) => {
      const elements = container.querySelectorAll(selector);
      removedCount += elements.length;
      elements.forEach((el) => el.remove());
    });

    if (debug) {
      console.log("🗑️ QuickAI Debug - Removed elements:", {
        totalRemoved: removedCount,
        selectors: unwantedSelectors,
      });
    }

    // Find main content - add Reddit-specific selectors
    const contentSelectors = [
      // Reddit specific
      '[data-testid="post-container"]',
      ".Post",
      '[slot="post-container"]',
      ".ListingLayout-outerContainer",
      "shreddit-post",
      // General selectors
      "main",
      "article",
      '[role="main"]',
      "#main",
      ".main",
      "#content",
      ".content",
      ".post-content",
      ".entry-content",
      ".article-body",
      ".markdown-body",
      ".article-content",
    ];

    let mainContent = null;
    let selectedSelector = null;
    for (const selector of contentSelectors) {
      mainContent = container.querySelector(selector);
      if (mainContent) {
        selectedSelector = selector;
        break;
      }
    }

    if (!mainContent) {
      mainContent = container.querySelector("body") || container;
      selectedSelector = "body (fallback)";
    }

    if (debug) {
      console.log("📍 QuickAI Debug - Content selector:", {
        selectedSelector,
        elementFound: !!mainContent,
        elementType: mainContent?.tagName,
        elementClasses: mainContent?.className,
        childrenCount: mainContent?.children.length,
      });
    }

    // Extract text more thoroughly
    let textParts = [];

    // Get all text nodes
    const walker = document.createTreeWalker(
      mainContent,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const text = node.textContent.trim();
          if (text.length === 0) return NodeFilter.FILTER_REJECT;

          // Skip script and style content
          const parent = node.parentElement;
          if (
            parent &&
            (parent.tagName === "SCRIPT" || parent.tagName === "STYLE")
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      textParts.push(node.textContent.trim());
    }

    // Join and clean up
    const textContent = textParts
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 10000); // Increased limit

    if (debug) {
      console.log("📝 QuickAI Debug - Content extraction complete:", {
        textPartsCount: textParts.length,
        totalLength: textContent.length,
        truncated: textParts.join(" ").length > 10000,
        preview: textContent.substring(0, 300) + "...",
        fullTextParts: textParts.slice(0, 10), // Show first 10 text parts
      });
    }

    const result = {
      title,
      description,
      content: textContent,
      url,
      debug: {
        selector: selectedSelector,
        partsCount: textParts.length,
        contentLength: textContent.length,
      },
    };

    return result;
  } catch (error) {
    console.error("❌ QuickAI Debug - Error extracting content:", error);
    return null;
  }
}

// Scrape content via iframe (for cross-origin)
async function scrapeViaIframe(linkUrl, debug = false) {
  if (debug) {
    console.log(
      "🔐 QuickAI Debug - Cross-origin link detected, requesting background tab scrape:",
      {
        url: linkUrl,
        method: "background tab via service worker",
      }
    );
  }

  // Request the service worker to scrape in a background tab
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "scrapeInBackgroundTab",
        url: linkUrl,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          if (debug) {
            console.error(
              "❌ QuickAI Debug - Background scrape error:",
              chrome.runtime.lastError
            );
          }
          resolve({
            title: "",
            description: "",
            content: "",
            url: linkUrl,
            crossOrigin: true,
            error: chrome.runtime.lastError.message,
          });
          return;
        }

        if (response && response.success) {
          if (debug) {
            console.log("✅ QuickAI Debug - Background scrape successful:", {
              title: response.data.title,
              contentLength: response.data.content?.length || 0,
              selector: response.data.debug?.selector,
            });
          }
          resolve(response.data);
        } else {
          if (debug) {
            console.log(
              "⚠️ QuickAI Debug - Background scrape failed:",
              response?.error
            );
          }
          resolve({
            title: "",
            description: "",
            content: "",
            url: linkUrl,
            crossOrigin: true,
            error: response?.error || "Failed to scrape content",
          });
        }
      }
    );
  });
}

// Summarize link content
async function summarizeLink(linkUrl, linkText, model) {
  const messageId = `ai-message-${Date.now()}`;
  const conversationArea = document.getElementById("quickai-conversation");

  // Update the initial message with the ID
  const aiMessage = conversationArea.querySelector(".quickai-ai-message");
  if (aiMessage) {
    aiMessage.id = messageId;
  }

  // Update loading message
  const messageContent = aiMessage?.querySelector(".quickai-message-content");
  if (messageContent) {
    messageContent.innerHTML = `
      <div class="quickai-status-container">
        <div class="quickai-loader"></div>
        <div class="quickai-status-text">
          <div style="font-weight: 600; color: #333;">Scraping link content...</div>
          <div style="font-size: 11px; color: #666; margin-top: 4px;">Attempting to fetch page content from ${
            new URL(linkUrl).hostname
          }</div>
        </div>
      </div>`;
  }

  // Try to scrape the content
  const scrapedContent = await scrapeLinkContent(linkUrl);

  // Show what was scraped
  if (messageContent) {
    if (scrapedContent && scrapedContent.content) {
      const contentPreview = scrapedContent.content.substring(0, 200) + "...";
      const debugInfo = scrapedContent.debug || {};

      messageContent.innerHTML = `
        <div class="quickai-status-container">
          <div class="quickai-loader"></div>
          <div class="quickai-status-text">
            <div style="font-weight: 600; color: #4caf50;">✓ Content scraped successfully!</div>
            <div style="font-size: 11px; color: #666; margin-top: 4px;">Title: ${
              scrapedContent.title || "No title found"
            }</div>
            <div style="font-size: 11px; color: #666; margin-top: 2px;">Content length: ${
              scrapedContent.content.length
            } characters</div>
            ${
              debugInfo.selector
                ? `<div style="font-size: 11px; color: #666; margin-top: 2px;">Selector used: ${debugInfo.selector}</div>`
                : ""
            }
            ${
              debugInfo.partsCount
                ? `<div style="font-size: 11px; color: #666; margin-top: 2px;">Text parts found: ${debugInfo.partsCount}</div>`
                : ""
            }
            
            <details style="margin-top: 8px;">
              <summary style="cursor: pointer; font-size: 11px; color: #1976d2;">Show scraped content preview</summary>
              <div style="margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 11px; color: #555; max-height: 150px; overflow-y: auto;">
                ${escapeHtml(contentPreview)}
              </div>
            </details>
            
            <details style="margin-top: 8px;">
              <summary style="cursor: pointer; font-size: 11px; color: #9c27b0;">Show debug information</summary>
              <div style="margin-top: 8px; padding: 8px; background: #f3e5f5; border-radius: 4px; font-size: 10px; color: #333; font-family: monospace; max-height: 200px; overflow-y: auto;">
                <div><strong>URL:</strong> ${escapeHtml(linkUrl)}</div>
                <div><strong>Title:</strong> ${escapeHtml(
                  scrapedContent.title || "None"
                )}</div>
                <div><strong>Description:</strong> ${escapeHtml(
                  scrapedContent.description || "None"
                )}</div>
                <div><strong>Selector:</strong> ${escapeHtml(
                  debugInfo.selector || "Unknown"
                )}</div>
                <div><strong>Text Parts:</strong> ${
                  debugInfo.partsCount || 0
                }</div>
                <div><strong>Content Length:</strong> ${
                  debugInfo.contentLength || 0
                }</div>
                <div style="margin-top: 8px;"><strong>Full scraped content:</strong></div>
                <pre style="white-space: pre-wrap; word-break: break-word; margin: 4px 0; padding: 8px; background: #fff; border: 1px solid #e1bee7; border-radius: 4px; max-height: 150px; overflow-y: auto;">
${escapeHtml(scrapedContent.content)}
                </pre>
              </div>
            </details>
            
            <div style="margin-top: 8px; font-weight: 600; color: #333;">Generating AI summary...</div>
          </div>
        </div>`;
    } else {
      messageContent.innerHTML = `
        <div class="quickai-status-container">
          <div class="quickai-loader"></div>
          <div class="quickai-status-text">
            <div style="font-weight: 600; color: #ff9800;">⚠️ Could not scrape content</div>
            <div style="font-size: 11px; color: #666; margin-top: 4px;">Reason: ${
              scrapedContent?.error || "Cross-origin restrictions"
            }</div>
            <div style="margin-top: 8px; font-weight: 600; color: #333;">Using AI knowledge about this link...</div>
          </div>
        </div>`;
    }
  }

  try {
    chrome.runtime.sendMessage({
      type: "summarizeLinkWithContent",
      linkUrl: linkUrl,
      linkText: linkText,
      scrapedContent: scrapedContent,
      model: model,
      messageId: messageId,
    });
  } catch (error) {
    console.error("Failed to send message to service worker:", error);
    if (messageContent) {
      messageContent.innerHTML =
        '<div class="quickai-error">Failed to process link. Please refresh the page and try again.</div>';
    }
  }
}

// Submit query for link
async function submitQueryForLink(linkUrl, linkText) {
  const prompt = document.getElementById("quickai-prompt").value.trim();
  if (!prompt) return;

  const model = document.getElementById("quickai-model").value;
  const conversationArea = document.getElementById("quickai-conversation");
  const submitBtn = document.getElementById("quickai-submit");
  const promptInput = document.getElementById("quickai-prompt");

  // Add user message to conversation
  const userMessage = document.createElement("div");
  userMessage.className = "quickai-message quickai-user-message";
  userMessage.innerHTML = `<div class="quickai-message-content">${escapeHtml(
    prompt
  )}</div>`;
  conversationArea.appendChild(userMessage);

  // Clear input
  promptInput.value = "";

  // Add AI message container with loading state
  const aiMessage = document.createElement("div");
  aiMessage.className = "quickai-message quickai-ai-message";
  aiMessage.id = `ai-message-${Date.now()}`;
  aiMessage.innerHTML =
    '<div class="quickai-message-content"><div class="quickai-loader"></div></div>';
  conversationArea.appendChild(aiMessage);

  // Scroll to bottom
  conversationArea.scrollTop = conversationArea.scrollHeight;

  // Store message ID for streaming updates
  const currentMessageId = aiMessage.id;

  submitBtn.disabled = true;
  submitBtn.textContent = "Processing...";

  try {
    chrome.runtime.sendMessage({
      type: "queryAI",
      context: `Link: ${linkUrl}\nLink Text: ${linkText}`,
      prompt: prompt,
      model: model,
      messageId: currentMessageId,
      isLinkQuery: true,
    });
  } catch (error) {
    console.error("Failed to send message to service worker:", error);
    const messageContent = aiMessage.querySelector(".quickai-message-content");
    if (messageContent) {
      messageContent.innerHTML =
        '<div class="quickai-error">Failed to connect to QuickAI service. Please refresh the page and try again.</div>';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
  }
}

// Execute quick action with predefined prompt
async function executeQuickAction(action, contextText) {
  const actionPrompts = {
    summarize: "Please provide a concise summary of the following text:",
    explain:
      "Please explain the following text in simple, easy-to-understand terms:",
    grammar:
      "Please fix any grammar, spelling, or punctuation mistakes in the following text. Return the corrected version:",
    improve:
      "Please improve the writing style of the following text while maintaining its meaning. Make it clearer and more engaging:",
    translate:
      "Please translate the following text to English (or to Spanish if it's already in English):",
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
  userMessage.innerHTML = `<div class="quickai-message-content">${escapeHtml(
    prompt
  )}</div>`;
  conversationArea.appendChild(userMessage);

  // Clear input only if it matches the submitted prompt
  if (promptInput && promptInput.value === prompt) {
    promptInput.value = "";
  }

  // Add AI message container with loading state
  const aiMessage = document.createElement("div");
  aiMessage.className = "quickai-message quickai-ai-message";
  aiMessage.id = `ai-message-${Date.now()}`;
  aiMessage.innerHTML =
    '<div class="quickai-message-content"><div class="quickai-loader"></div></div>';
  conversationArea.appendChild(aiMessage);

  // Scroll to bottom
  conversationArea.scrollTop = conversationArea.scrollHeight;

  // Store message ID for streaming updates
  const currentMessageId = aiMessage.id;

  submitBtn.disabled = true;
  submitBtn.textContent = "Processing...";

  // Disable all quick action buttons during processing
  document.querySelectorAll(".quickai-action-btn").forEach((btn) => {
    btn.disabled = true;
  });

  // Get stored context from the container
  let storedContext;
  try {
    const container = document.getElementById("quickai-container");
    storedContext = container?.dataset.fullContext
      ? JSON.parse(container.dataset.fullContext)
      : null;
  } catch (e) {
    console.error("Error parsing stored context:", e);
    storedContext = null;
  }

  // Check if page context is enabled and get it
  let pageContent = null;
  const includePageContext = document.getElementById(
    "quickai-include-page-context"
  )?.checked;
  if (includePageContext) {
    try {
      const container = document.getElementById("quickai-container");
      if (container?.dataset.pageContent) {
        pageContent = JSON.parse(container.dataset.pageContent);
      } else {
        // Extract page content if not cached
        pageContent = extractFullPageContent();
        if (pageContent) {
          container.dataset.pageContent = JSON.stringify(pageContent);
        }
      }
    } catch (e) {
      console.error("Error getting page content:", e);
    }
  }

  // Send to service worker with full context
  const contextToSend = storedContext ||
    fullContext || {
      selected: contextText,
      before: "",
      after: "",
      full: contextText,
    };

  // Prepare tab contexts for sending
  const tabContentsArray = Array.from(tabContexts.entries()).map(
    ([tabId, content]) => ({
      tabId,
      title: content.title,
      url: content.url,
      content: content.content,
    })
  );

  try {
    chrome.runtime.sendMessage({
      type: "queryAI",
      context: contextText,
      fullContext: contextToSend,
      pageContent: pageContent,
      includePageContext: includePageContext,
      tabContexts: tabContentsArray, // Send tab contexts
      prompt: prompt,
      model: model,
      messageId: currentMessageId, // Pass message ID for targeted updates
    });
  } catch (error) {
    console.error("Failed to send message to service worker:", error);
    const messageContent = aiMessage.querySelector(".quickai-message-content");
    if (messageContent) {
      messageContent.innerHTML =
        '<div class="quickai-error">Failed to connect to QuickAI service. Please refresh the page and try again.</div>';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
    // Re-enable quick action buttons on error
    document.querySelectorAll(".quickai-action-btn").forEach((btn) => {
      btn.disabled = false;
    });
  }
}

// Handle streaming responses
if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage
) {
  chrome.runtime.onMessage.addListener((message) => {
    // Handle googleScreenshotProgress without requiring messageId
    if (message.type === "googleScreenshotProgress") {
      const progressStatus = document.querySelector(
        ".quickai-google-progress-status"
      );
      const progressBar = document.querySelector(
        ".quickai-google-progress-fill"
      );
      if (progressStatus && progressBar) {
        // Update status text with detailed progress
        progressStatus.textContent =
          message.status ||
          `Capturing screenshot ${message.current} of ${message.total}...`;

        // Calculate overall progress
        let overallProgress;
        if (message.pageProgress !== undefined) {
          // More granular progress: account for partial page capture
          const baseProgress = ((message.current - 1) / message.total) * 100;
          const pageContribution = message.pageProgress / message.total;
          overallProgress = baseProgress + pageContribution;
        } else {
          // Simple progress
          overallProgress = (message.current / message.total) * 100;
        }

        progressBar.style.width = `${Math.min(overallProgress, 100)}%`;
      }
      return;
    }

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
        // Accumulate the full response
        messageContent.dataset.fullResponse =
          (messageContent.dataset.fullResponse || "") + message.rawContent;
        // Format and display the markdown
        messageContent.innerHTML = formatMarkdown(
          messageContent.dataset.fullResponse
        );
        conversationArea.scrollTop = conversationArea.scrollHeight;
        break;

      case "streamEnd":
        // Add copy button
        const copyBtn = document.createElement("button");
        copyBtn.className = "quickai-copy-btn";
        copyBtn.innerHTML = "📋 Copy";
        copyBtn.onclick = () =>
          copyResponse(messageContent.dataset.fullResponse);
        messageContent.appendChild(copyBtn);

        // Add replace button if the selection was in an editable element
        const container = document.getElementById("quickai-container");
        if (
          container &&
          container.dataset.isEditable === "true" &&
          editableElement
        ) {
          const replaceBtn = document.createElement("button");
          replaceBtn.className = "quickai-replace-btn";
          replaceBtn.innerHTML = "↔️ Replace";
          replaceBtn.onclick = () =>
            replaceSelectedText(messageContent.dataset.fullResponse);
          messageContent.appendChild(replaceBtn);
        }

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || "Send";
        }

        // Re-enable quick action buttons
        document.querySelectorAll(".quickai-action-btn").forEach((btn) => {
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
        document.querySelectorAll(".quickai-action-btn").forEach((btn) => {
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
    if (
      editableElement.tagName === "TEXTAREA" ||
      editableElement.tagName === "INPUT"
    ) {
      editableElement.focus();

      // If we have a selection and selected text
      if (originalSelection && selectedText) {
        // Try to get the stored selection range from the original selection
        let start, end;

        if (
          originalSelection &&
          originalSelection.startContainer === editableElement.firstChild
        ) {
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
            if (editableElement.value && !editableElement.value.endsWith(" ")) {
              newText = " " + newText;
            }
          }
        }

        // Use setRangeText to replace and maintain undo history
        editableElement.setRangeText(newText, start, end, "end");
      } else {
        // No selection - append to existing content or replace all
        if (editableElement.value.trim()) {
          // If there's existing content, append
          const separator = editableElement.value.endsWith(" ") ? "" : " ";
          editableElement.value += separator + newText;
        } else {
          // If empty, just set the value
          editableElement.value = newText;
        }
      }

      // Dispatch input event to trigger any listeners
      editableElement.dispatchEvent(new Event("input", { bubbles: true }));

      // Show success feedback
      showReplacementFeedback(true);
    } else if (
      editableElement.isContentEditable ||
      editableElement.contentEditable === "true" ||
      editableElement.getAttribute("role") === "textbox" ||
      editableElement.getAttribute("g_editable") === "true"
    ) {
      // For contenteditable elements (including Gmail and Google Docs)
      editableElement.focus();

      // Special handling for Google Docs
      if (
        editableElement.classList.contains("kix-page") ||
        editableElement.closest(".kix-page")
      ) {
        // Google Docs requires special handling - just copy to clipboard and notify user
        await navigator.clipboard.writeText(newText);
        showReplacementFeedback(
          true,
          "Copied to clipboard! Press Ctrl+V to paste in Google Docs"
        );
        return;
      }

      const selection = window.getSelection();

      // Special handling for Gmail
      if (
        editableElement.getAttribute("g_editable") === "true" ||
        editableElement.getAttribute("role") === "textbox"
      ) {
        // Gmail-specific approach
        if (originalSelection && selectedText) {
          selection.removeAllRanges();
          selection.addRange(originalSelection);

          // Try multiple methods for Gmail compatibility
          if (!document.execCommand("insertText", false, newText)) {
            // Fallback: dispatch input events
            const inputEvent = new InputEvent("beforeinput", {
              inputType: "insertText",
              data: newText,
              bubbles: true,
              cancelable: true,
            });
            editableElement.dispatchEvent(inputEvent);
          }
        } else {
          // No selection - append to end
          editableElement.focus();
          selection.selectAllChildren(editableElement);
          selection.collapseToEnd();

          const textToInsert =
            editableElement.textContent.trim() &&
            !editableElement.textContent.endsWith(" ")
              ? " " + newText
              : newText;
          document.execCommand("insertText", false, textToInsert);
        }
      } else {
        // Standard contenteditable handling
        if (originalSelection && selectedText) {
          selection.removeAllRanges();
          selection.addRange(originalSelection);
          document.execCommand("insertText", false, newText);
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

          const textToInsert =
            editableElement.textContent.trim() &&
            !editableElement.textContent.endsWith(" ")
              ? " " + newText
              : newText;
          document.execCommand("insertText", false, textToInsert);
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
if (
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage
) {
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

// Template selector state
let templateSelectorActive = false;
let templateSearchQuery = "";
let selectedTemplateIndex = 0;

// Create template selector UI
function createTemplateSelector(textarea, templates, searchQuery = "") {
  console.log(
    "Creating template selector with templates:",
    templates,
    "search:",
    searchQuery
  );

  // Remove existing selector
  const existingSelector = document.getElementById("quickai-template-selector");
  if (existingSelector) existingSelector.remove();

  // Filter templates based on search query
  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  console.log("Filtered templates:", filteredTemplates);

  // Show message if no templates exist at all
  if (templates.length === 0) {
    const selector = document.createElement("div");
    selector.id = "quickai-template-selector";
    selector.className = "quickai-template-selector";
    selector.innerHTML =
      '<div class="quickai-template-item">No templates yet. Add templates in extension options.</div>';

    const textareaRect = textarea.getBoundingClientRect();
    selector.style.position = "fixed";
    selector.style.left = `${textareaRect.left}px`;
    selector.style.top = `${textareaRect.top - 60}px`;
    selector.style.zIndex = "2147483650";

    document.body.appendChild(selector);
    console.log("Created empty templates message");
    return selector;
  }

  if (filteredTemplates.length === 0) return null;

  const selector = document.createElement("div");
  selector.id = "quickai-template-selector";
  selector.className = "quickai-template-selector";

  // Position above textarea
  const textareaRect = textarea.getBoundingClientRect();
  const caretCoordinates = getCaretCoordinates(
    textarea,
    textarea.selectionStart
  );

  selector.style.position = "fixed";

  // Calculate position - try to position above the textarea
  let top = textareaRect.top - 210; // 200px max height + 10px margin

  // If it would go off screen, position below instead
  if (top < 10) {
    top = textareaRect.bottom + 10;
  }

  selector.style.top = `${top}px`;
  selector.style.left = `${Math.max(
    10,
    textareaRect.left + caretCoordinates.left
  )}px`;
  selector.style.maxHeight = "200px";
  selector.style.overflowY = "auto";
  selector.style.zIndex = "2147483650"; // Higher than the main container

  // Create template items
  filteredTemplates.forEach((template, index) => {
    const item = document.createElement("div");
    item.className = "quickai-template-item";
    if (index === selectedTemplateIndex) {
      item.classList.add("selected");
    }

    item.innerHTML = `
      <div class="template-name">${escapeHtml(template.name)}</div>
      ${
        template.category
          ? `<div class="template-category">${escapeHtml(
              template.category
            )}</div>`
          : ""
      }
      <div class="template-preview">${escapeHtml(
        template.content.substring(0, 50)
      )}...</div>
    `;

    item.addEventListener("click", () => {
      insertTemplate(textarea, template);
    });

    selector.appendChild(item);
  });

  document.body.appendChild(selector);
  console.log("Template selector added to DOM:", selector);
  return selector;
}

// Get caret coordinates for positioning
function getCaretCoordinates(element, position) {
  const div = document.createElement("div");
  const style = getComputedStyle(element);
  const properties = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
  ];

  properties.forEach((prop) => {
    div.style[prop] = style[prop];
  });

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";

  document.body.appendChild(div);

  div.textContent = element.value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = element.value.substring(position) || ".";
  div.appendChild(span);

  const coordinates = {
    left: span.offsetLeft + parseInt(style.borderLeftWidth),
    top: span.offsetTop - element.scrollTop + parseInt(style.borderTopWidth),
  };

  document.body.removeChild(div);
  return coordinates;
}

// Insert template into textarea
function insertTemplate(textarea, template) {
  const cursorPos = textarea.selectionStart;
  const textBefore = textarea.value.substring(0, cursorPos);
  const textAfter = textarea.value.substring(cursorPos);

  // Find the @ symbol position
  const atSymbolIndex = textBefore.lastIndexOf("@");
  const newTextBefore = textBefore.substring(0, atSymbolIndex);

  // Insert the template content
  textarea.value = newTextBefore + template.content + textAfter;

  // Set cursor position after the inserted template
  const newCursorPos = newTextBefore.length + template.content.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  textarea.focus();

  // Close template selector
  closeTemplateSelector();

  // If template has placeholders, select the first one
  const placeholderMatch = template.content.match(/\{\{(\w+)\}\}/);
  if (placeholderMatch) {
    const placeholderStart = newTextBefore.length + placeholderMatch.index;
    const placeholderEnd = placeholderStart + placeholderMatch[0].length;
    textarea.setSelectionRange(placeholderStart, placeholderEnd);
  }
}

// Close template selector
function closeTemplateSelector() {
  const selector = document.getElementById("quickai-template-selector");
  if (selector) selector.remove();
  templateSelectorActive = false;
  templateSearchQuery = "";
  selectedTemplateIndex = 0;
}

// Handle template selector keyboard navigation
async function handleTemplateSelectorKeyboard(e, textarea) {
  const selector = document.getElementById("quickai-template-selector");
  if (!selector) return false;

  const items = selector.querySelectorAll(".quickai-template-item");

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selectedTemplateIndex = Math.min(
        selectedTemplateIndex + 1,
        items.length - 1
      );
      updateSelectedTemplate(items);
      return true;

    case "ArrowUp":
      e.preventDefault();
      selectedTemplateIndex = Math.max(selectedTemplateIndex - 1, 0);
      updateSelectedTemplate(items);
      return true;

    case "Enter":
    case "Tab":
      e.preventDefault();
      if (items[selectedTemplateIndex]) {
        const { promptTemplates = [] } = await chrome.storage.sync.get(
          "promptTemplates"
        );
        const filteredTemplates = promptTemplates.filter(
          (t) =>
            t.name.toLowerCase().includes(templateSearchQuery.toLowerCase()) ||
            t.category
              ?.toLowerCase()
              .includes(templateSearchQuery.toLowerCase()) ||
            t.content.toLowerCase().includes(templateSearchQuery.toLowerCase())
        );
        if (filteredTemplates[selectedTemplateIndex]) {
          insertTemplate(textarea, filteredTemplates[selectedTemplateIndex]);
        }
      }
      return true;

    case "Escape":
      e.preventDefault();
      closeTemplateSelector();
      return true;
  }

  return false;
}

// Update selected template visual
function updateSelectedTemplate(items) {
  items.forEach((item, index) => {
    if (index === selectedTemplateIndex) {
      item.classList.add("selected");
      item.scrollIntoView({ block: "nearest" });
    } else {
      item.classList.remove("selected");
    }
  });
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
    // Collapse
    container.classList.remove("quickai-expanded");
    expandBtn.innerHTML = "⬜";
    expandBtn.title = "Expand";

    // Remove backdrop
    const backdrop = document.querySelector(".quickai-modal-backdrop");
    if (backdrop) {
      backdrop.classList.remove("active");
      setTimeout(() => backdrop.remove(), 300);
    }
  } else {
    // Expand
    container.classList.add("quickai-expanded");
    expandBtn.innerHTML = "⬛";
    expandBtn.title = "Collapse";

    // Add backdrop
    const backdrop = document.createElement("div");
    backdrop.className = "quickai-modal-backdrop";
    document.body.appendChild(backdrop);

    // Animate in
    setTimeout(() => {
      backdrop.classList.add("active");
    }, 10);

    // Close on backdrop click
    backdrop.addEventListener("click", () => {
      toggleExpand(); // Collapse when backdrop clicked
    });
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
    const match = text.match(/const\s+models\s*=\s*(\[[\s\S]*?\]);/m);

    if (match && match[1]) {
      try {
        // Parse JSON safely without eval
        // First, remove comments
        let cleanedString = match[1]
          .replace(/\/\/.*$/gm, "") // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, ""); // Remove multi-line comments

        // Then convert to proper JSON
        const jsonString = cleanedString
          .replace(/'/g, '"')
          .replace(/(\w+):/g, '"$1":')
          .replace(/,\s*]/g, "]") // Remove trailing commas in arrays
          .replace(/,\s*}/g, "}"); // Remove trailing commas in objects

        const modelsArray = JSON.parse(jsonString);
        console.log("Loaded", modelsArray.length, "models from models.js");
        return modelsArray;
      } catch (e) {
        console.error("Failed to parse models:", e);
        throw new Error("Could not parse models from models.js");
      }
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

// Format markdown to HTML
function formatMarkdown(text) {
  if (!text) return "";

  // Escape HTML first to prevent XSS
  let html = escapeHtml(text);

  // Headers
  html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");

  // Bold and Italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Lists
  html = html.replace(/^\* (.*)$/gm, "<li>$1</li>");
  html = html.replace(/^\- (.*)$/gm, "<li>$1</li>");
  html = html.replace(/^\d+\. (.*)$/gm, "<li>$1</li>");

  // Wrap consecutive list items
  html = html.replace(/(<li>.*<\/li>\s*)+/g, function (match) {
    return "<ul>" + match + "</ul>";
  });

  // Line breaks
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraphs
  html = "<p>" + html + "</p>";

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, "");
  html = html.replace(/<p>(<h[1-3]>)/g, "$1");
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, "$1");
  html = html.replace(/<p>(<ul>)/g, "$1");
  html = html.replace(/(<\/ul>)<\/p>/g, "$1");
  html = html.replace(/<p>(<pre>)/g, "$1");
  html = html.replace(/(<\/pre>)<\/p>/g, "$1");

  return html;
}

// Click outside to close - DISABLED for all UI types
// Users must explicitly click the X button to close
/*
document.addEventListener("click", (e) => {
  if (activeUI && !activeUI.contains(e.target) && e.target !== floatingButton) {
    const selection = window.getSelection();
    if (selection.toString().trim() === "") {
      closeUI();
    }
  }
});
*/

// Add link hover detection
document.addEventListener("mouseover", (e) => {
  const link = e.target.closest("a");

  // Only process if it's a link with href and not the currently hovered one
  if (link && link.href && link !== hoveredLink && !activeUI) {
    // Clear any existing timeout
    if (linkHoverTimeout) {
      clearTimeout(linkHoverTimeout);
    }

    // Set new hovered link
    hoveredLink = link;
    currentLinkUrl = link.href;

    // Show button after delay to avoid flickering
    linkHoverTimeout = setTimeout(() => {
      if (
        hoveredLink === link &&
        !floatingButton &&
        !window.getSelection().toString().trim()
      ) {
        const rect = link.getBoundingClientRect();
        showFloatingButton("link", rect, {
          url: link.href,
          text: link.textContent || link.href,
        });
      }
    }, 300);
  }
});

// Handle mouse leave from links
document.addEventListener("mouseout", (e) => {
  const link = e.target.closest("a");

  if (link === hoveredLink) {
    // Clear timeout
    if (linkHoverTimeout) {
      clearTimeout(linkHoverTimeout);
      linkHoverTimeout = null;
    }

    // Hide button if it's a link button
    if (floatingButton && floatingButton.dataset.type === "link") {
      // Add small delay to allow clicking the button
      setTimeout(() => {
        if (
          floatingButton &&
          floatingButton.dataset.type === "link" &&
          !floatingButton.matches(":hover")
        ) {
          hideFloatingButton();
        }
      }, 100);
    }

    hoveredLink = null;
    currentLinkUrl = null;
  }
});

// Listen for Ctrl+C to show question mark with clipboard content
document.addEventListener("keydown", async (e) => {
  if (e.ctrlKey && e.key === "c") {
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
            height: 100,
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

// Shift+Click detection
document.addEventListener("click", (e) => {
  // Check if shift key is pressed and not clicking on existing UI elements
  if (
    e.shiftKey &&
    !activeUI &&
    !floatingButton &&
    !e.target.closest('input, textarea, [contenteditable="true"]')
  ) {
    e.preventDefault();
    e.stopPropagation();

    // Set position for button to appear at click location
    selectionRect = {
      left: e.clientX - 20,
      top: e.clientY - 40,
      right: e.clientX + 20,
      bottom: e.clientY,
      width: 40,
      height: 40,
    };

    // Clear any selected text
    selectedText = "";
    fullContext = null;
    originalSelection = null;
    editableElement = null;

    // Show the floating button
    showFloatingButton();
  }
});

// Speech recognition variables
let recognition = null;
let isRecording = false;

// Initialize speech recognition
function initSpeechRecognition() {
  if (
    !("webkitSpeechRecognition" in window) &&
    !("SpeechRecognition" in window)
  ) {
    console.warn("Speech recognition not supported");
    return null;
  }

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  return recognition;
}

// Start voice recognition
function startVoiceRecognition() {
  const voiceBtn = document.getElementById("quickai-voice");
  const promptTextarea = document.getElementById("quickai-prompt");

  if (!voiceBtn || !promptTextarea) return;

  if (isRecording) {
    // Stop recording
    if (recognition) {
      recognition.stop();
    }
    return;
  }

  // Initialize recognition if not already done
  if (!recognition) {
    recognition = initSpeechRecognition();
    if (!recognition) {
      alert(
        "Speech recognition is not supported in your browser. Please use Chrome or Edge."
      );
      return;
    }

    // Set up event handlers
    recognition.onstart = () => {
      isRecording = true;
      voiceBtn.classList.add("recording");
      voiceBtn.title = "Stop recording";
    };

    recognition.onend = () => {
      isRecording = false;
      voiceBtn.classList.remove("recording");
      voiceBtn.title = "Voice to text with AI cleanup";
    };

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interimTranscript += transcript;
        }
      }

      // When we have a final transcript, send it for cleanup
      if (finalTranscript) {
        cleanupTranscript(finalTranscript.trim(), promptTextarea);
      } else if (interimTranscript) {
        // Show interim results in a temporary way
        const tempText = `[Recording...] ${interimTranscript}`;
        promptTextarea.value = tempText;
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      isRecording = false;
      voiceBtn.classList.remove("recording");
      voiceBtn.title = "Voice to text";

      if (event.error === "not-allowed") {
        alert(
          "Microphone access was denied. Please allow microphone access and try again."
        );
      }
    };
  }

  // Start recognition
  try {
    recognition.start();
  } catch (error) {
    console.error("Failed to start speech recognition:", error);
    alert("Failed to start voice recognition. Please try again.");
  }
}

// Clean up transcript using AI
async function cleanupTranscript(rawTranscript, promptTextarea) {
  // Show loading state
  const originalValue = promptTextarea.value;
  promptTextarea.value = `[Cleaning up transcript...] ${rawTranscript}`;
  promptTextarea.disabled = true;

  try {
    // Get current model
    const modelSelect = document.getElementById("quickai-model");
    const currentModel =
      modelSelect?.value || "google/gemini-2.0-flash-thinking";

    // Send message to service worker for transcript cleanup
    const response = await chrome.runtime.sendMessage({
      action: "cleanupTranscript",
      transcript: rawTranscript,
      model: currentModel,
    });

    if (response.error) {
      console.error("Transcript cleanup error:", response.error);
      // Fall back to raw transcript
      promptTextarea.value = rawTranscript;
    } else if (response.cleanedText) {
      // Use cleaned transcript
      promptTextarea.value = response.cleanedText;
    }
  } catch (error) {
    console.error("Failed to clean up transcript:", error);
    // Fall back to raw transcript
    promptTextarea.value = rawTranscript;
  } finally {
    promptTextarea.disabled = false;
    promptTextarea.focus();
  }
}

// Tab selection functionality
let selectedTabs = new Set();
let tabSelectorModal = null;
let tabContexts = new Map(); // Store scraped tab contents

function openTabSelector() {
  // Create backdrop with higher z-index for tab selector
  const backdrop = document.createElement("div");
  backdrop.className = "quickai-modal-backdrop";
  backdrop.style.zIndex = "2147483648";
  document.body.appendChild(backdrop);

  // Create modal
  tabSelectorModal = document.createElement("div");
  tabSelectorModal.className = "quickai-tab-selector-modal";

  tabSelectorModal.innerHTML = `
    <div class="quickai-tab-selector-header">
      <h3 class="quickai-tab-selector-title">Select Tabs for Context</h3>
      <button class="quickai-tab-selector-close">&times;</button>
    </div>
    <div class="quickai-tab-selector-search">
      <input type="text" class="quickai-tab-search-input" placeholder="Search tabs by title or URL...">
    </div>
    <div class="quickai-tab-selector-body">
      <div class="quickai-tab-list">
        <div class="quickai-loader" style="margin: 40px auto;"></div>
      </div>
    </div>
    <div class="quickai-tab-selector-footer">
      <span class="quickai-tab-count">0 tabs selected</span>
      <div class="quickai-tab-selector-actions">
        <button class="quickai-tab-selector-cancel">Cancel</button>
        <button class="quickai-tab-selector-confirm" disabled>Add to Context</button>
      </div>
    </div>
  `;

  document.body.appendChild(tabSelectorModal);

  // Animate in
  setTimeout(() => {
    backdrop.classList.add("active");
  }, 10);

  // Load tabs
  loadTabs();

  // Add event listeners
  const closeBtn = tabSelectorModal.querySelector(
    ".quickai-tab-selector-close"
  );
  const cancelBtn = tabSelectorModal.querySelector(
    ".quickai-tab-selector-cancel"
  );
  const confirmBtn = tabSelectorModal.querySelector(
    ".quickai-tab-selector-confirm"
  );
  const searchInput = tabSelectorModal.querySelector(
    ".quickai-tab-search-input"
  );

  closeBtn.addEventListener("click", closeTabSelector);
  cancelBtn.addEventListener("click", closeTabSelector);
  confirmBtn.addEventListener("click", confirmTabSelection);
  searchInput.addEventListener("input", filterTabs);

  // Close on backdrop click
  backdrop.addEventListener("click", closeTabSelector);

  // Focus search input
  searchInput.focus();
}

function closeTabSelector() {
  const backdrop = document.querySelector(".quickai-modal-backdrop");
  if (backdrop) {
    backdrop.classList.remove("active");
    setTimeout(() => backdrop.remove(), 300);
  }
  if (tabSelectorModal) {
    tabSelectorModal.remove();
    tabSelectorModal = null;
  }
}

async function loadTabs() {
  try {
    // Request tabs from service worker
    chrome.runtime.sendMessage({ type: "getTabs" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Failed to get tabs:", chrome.runtime.lastError);
        showTabError();
        return;
      }

      if (response && response.tabs) {
        displayTabs(response.tabs);
      }
    });
  } catch (error) {
    console.error("Error loading tabs:", error);
    showTabError();
  }
}

function displayTabs(tabs) {
  const tabList = tabSelectorModal.querySelector(".quickai-tab-list");

  // Filter out current tab
  const currentTabUrl = window.location.href;
  const filteredTabs = tabs.filter((tab) => tab.url !== currentTabUrl);

  if (filteredTabs.length === 0) {
    tabList.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #666;">
        No other tabs found. Open some tabs and try again.
      </div>
    `;
    return;
  }

  tabList.innerHTML = filteredTabs
    .map(
      (tab) => `
    <div class="quickai-tab-item" data-tab-id="${tab.id}">
      <input type="checkbox" class="quickai-tab-checkbox" data-tab-id="${
        tab.id
      }">
      ${
        tab.favIconUrl
          ? `<img src="${escapeHtml(
              tab.favIconUrl
            )}" class="quickai-tab-favicon" onerror="this.style.display='none'">`
          : ""
      }
      <div class="quickai-tab-info">
        <div class="quickai-tab-title">${escapeHtml(
          tab.title || "Untitled"
        )}</div>
        <div class="quickai-tab-url">${escapeHtml(
          new URL(tab.url).hostname
        )}</div>
      </div>
    </div>
  `
    )
    .join("");

  // Add click handlers
  tabList.querySelectorAll(".quickai-tab-item").forEach((item) => {
    const checkbox = item.querySelector(".quickai-tab-checkbox");
    const tabId = parseInt(item.dataset.tabId);

    item.addEventListener("click", (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        toggleTabSelection(tabId, checkbox.checked);
      }
    });

    checkbox.addEventListener("change", (e) => {
      toggleTabSelection(tabId, e.target.checked);
    });

    // Check if already selected
    if (selectedTabs.has(tabId)) {
      checkbox.checked = true;
      item.classList.add("selected");
    }
  });

  updateTabCount();
}

function toggleTabSelection(tabId, isSelected) {
  const item = tabSelectorModal.querySelector(
    `.quickai-tab-item[data-tab-id="${tabId}"]`
  );

  if (isSelected) {
    selectedTabs.add(tabId);
    item.classList.add("selected");
  } else {
    selectedTabs.delete(tabId);
    item.classList.remove("selected");
    // Remove from context if already scraped
    tabContexts.delete(tabId);
  }

  updateTabCount();
}

function updateTabCount() {
  const countElement = tabSelectorModal.querySelector(".quickai-tab-count");
  const confirmBtn = tabSelectorModal.querySelector(
    ".quickai-tab-selector-confirm"
  );

  const count = selectedTabs.size;
  countElement.textContent = `${count} tab${count !== 1 ? "s" : ""} selected`;
  confirmBtn.disabled = count === 0;
}

function filterTabs() {
  const searchInput = tabSelectorModal.querySelector(
    ".quickai-tab-search-input"
  );
  const query = searchInput.value.toLowerCase();
  const items = tabSelectorModal.querySelectorAll(".quickai-tab-item");

  items.forEach((item) => {
    const title = item
      .querySelector(".quickai-tab-title")
      .textContent.toLowerCase();
    const url = item
      .querySelector(".quickai-tab-url")
      .textContent.toLowerCase();

    if (title.includes(query) || url.includes(query)) {
      item.style.display = "flex";
    } else {
      item.style.display = "none";
    }
  });
}

async function confirmTabSelection() {
  if (selectedTabs.size === 0) return;

  const confirmBtn = tabSelectorModal.querySelector(
    ".quickai-tab-selector-confirm"
  );
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Scraping content...";

  try {
    // Request service worker to scrape selected tabs
    const tabIds = Array.from(selectedTabs);

    chrome.runtime.sendMessage(
      {
        type: "scrapeMultipleTabs",
        tabIds: tabIds,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("Failed to scrape tabs:", chrome.runtime.lastError);
          showScrapeError();
          return;
        }

        if (response && response.results) {
          // Store scraped content
          response.results.forEach((result) => {
            if (result.success) {
              tabContexts.set(result.tabId, result.content);
            }
          });

          // Update UI to show included contexts
          updateContextIndicators();
          closeTabSelector();
        }
      }
    );
  } catch (error) {
    console.error("Error scraping tabs:", error);
    showScrapeError();
  }
}

function updateContextIndicators() {
  const indicatorsContainer = document.getElementById(
    "quickai-context-indicators"
  );
  const tabSelectorBtn = document.getElementById("quickai-tab-selector");

  if (!indicatorsContainer) return;

  // Clear existing indicators
  const existingChips = indicatorsContainer.querySelectorAll(
    ".quickai-context-chip"
  );
  existingChips.forEach((chip) => chip.remove());

  // Update button state
  if (tabSelectorBtn) {
    if (tabContexts.size > 0) {
      tabSelectorBtn.classList.add("has-context");
      tabSelectorBtn.title = `${tabContexts.size} tab${
        tabContexts.size > 1 ? "s" : ""
      } included`;
    } else {
      tabSelectorBtn.classList.remove("has-context");
      tabSelectorBtn.title = "Include tab content";
    }
  }

  // Show/hide container
  if (tabContexts.size === 0) {
    indicatorsContainer.style.display = "none";
    return;
  }

  indicatorsContainer.style.display = "flex";

  // Add chips for each included tab
  tabContexts.forEach((content, tabId) => {
    const chip = document.createElement("div");
    chip.className = "quickai-context-chip active";
    chip.innerHTML = `
      <span>${escapeHtml(content.title || "Tab " + tabId)}</span>
      <span class="quickai-context-chip-remove" data-tab-id="${tabId}">&times;</span>
    `;

    chip
      .querySelector(".quickai-context-chip-remove")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        removeTabContext(tabId);
      });

    indicatorsContainer.appendChild(chip);
  });
}

function removeTabContext(tabId) {
  tabContexts.delete(tabId);
  selectedTabs.delete(tabId);
  updateContextIndicators();
}

function showTabError() {
  const tabList = tabSelectorModal.querySelector(".quickai-tab-list");
  tabList.innerHTML = `
    <div style="text-align: center; padding: 40px; color: #d32f2f;">
      Failed to load tabs. Please try again.
    </div>
  `;
}

function showScrapeError() {
  const confirmBtn = tabSelectorModal.querySelector(
    ".quickai-tab-selector-confirm"
  );
  confirmBtn.disabled = false;
  confirmBtn.textContent = "Failed - Try Again";

  setTimeout(() => {
    confirmBtn.textContent = "Add to Context";
  }, 2000);
}

// Google Search functionality
async function initiateGoogleSearch(rect, searchQuery) {
  try {
    // Create UI for Google search
    createGoogleSearchUI(rect, searchQuery);

    // Clear previous results
    googleSearchResults = [];
    googleScrapedContent.clear();

    // Open Google search in new tab
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
      searchQuery
    )}`;

    // Request service worker to handle Google search
    chrome.runtime.sendMessage(
      {
        type: "performGoogleSearch",
        query: searchQuery,
        url: googleUrl,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Failed to perform Google search:",
            chrome.runtime.lastError
          );
          updateGoogleSearchError("Failed to perform search");
          return;
        }

        if (response && response.results) {
          googleSearchResults = response.results;
          startScrapingGoogleResults();
        } else {
          updateGoogleSearchError("No results found");
        }
      }
    );
  } catch (error) {
    console.error("Error initiating Google search:", error);
    updateGoogleSearchError("Search failed");
  }
}

// Create Google search UI
function createGoogleSearchUI(rect, searchQuery) {
  if (activeUI) activeUI.remove();

  const container = document.createElement("div");
  container.id = "quickai-container";
  container.className = "quickai-container";

  // Store search query
  container.dataset.googleQuery = searchQuery;
  container.dataset.isGoogleSearch = "true";

  // Position near selected text
  const top = window.scrollY + rect.bottom + 10;
  const left = window.scrollX + rect.left;

  container.style.top = `${top}px`;
  container.style.left = `${left}px`;

  container.innerHTML = `
    <div class="quickai-gradient-border"></div>
    <div class="quickai-content">
      <div class="quickai-header">
        <span class="quickai-title">QuickAI - Google Search</span>
        <div class="quickai-header-buttons">
          <button id="quickai-expand" class="quickai-expand" title="Expand">⬜</button>
          <button id="quickai-clear" class="quickai-clear" title="Clear conversation">🗑️</button>
          <button id="quickai-close" class="quickai-close">&times;</button>
        </div>
      </div>
      <div class="quickai-context">
        <strong>Search Query:</strong> <span class="quickai-context-text">${escapeHtml(
          searchQuery.substring(0, 100)
        )}${searchQuery.length > 100 ? "..." : ""}</span>
      </div>
      <div id="quickai-google-progress" class="quickai-google-progress">
        <div class="quickai-google-progress-header">
          <div class="quickai-google-icon">G</div>
          <div class="quickai-google-progress-title">Searching Google...</div>
        </div>
        <div class="quickai-google-progress-status">Opening Google search and extracting results...</div>
        <div class="quickai-google-progress-bar">
          <div class="quickai-google-progress-fill" style="width: 0%"></div>
        </div>
        <div class="quickai-google-results-list" id="quickai-google-results"></div>
      </div>
      <div id="quickai-conversation" class="quickai-conversation"></div>
      <div class="quickai-input-area">
        <div class="quickai-textarea-wrapper">
          <textarea id="quickai-prompt" class="quickai-prompt" placeholder="Add your question about the search results..." rows="3"></textarea>
          <button id="quickai-voice" class="quickai-voice-btn" title="Voice to text with AI cleanup" aria-label="Voice to text with AI cleanup">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 11C9.66 11 11 9.66 11 8V4C11 2.34 9.66 1 8 1C6.34 1 5 2.34 5 4V8C5 9.66 6.34 11 8 11Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M13 8C13 10.76 10.76 13 8 13C5.24 13 3 10.76 3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 13V15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="quickai-controls">
          <select id="quickai-model" class="quickai-model-select">
            <!-- Models will be loaded dynamically -->
          </select>
          <button id="quickai-submit" class="quickai-submit" disabled>Submit</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);
  activeUI = container;

  // Add event listeners
  document.getElementById("quickai-close").addEventListener("click", closeUI);
  document
    .getElementById("quickai-clear")
    .addEventListener("click", clearConversation);
  document
    .getElementById("quickai-expand")
    .addEventListener("click", toggleExpand);
  document
    .getElementById("quickai-submit")
    .addEventListener("click", () => submitGoogleQuery());
  const promptTextarea = document.getElementById("quickai-prompt");
  promptTextarea.addEventListener("keydown", async (e) => {
    // Handle template selector navigation first
    if (templateSelectorActive) {
      const handled = await handleTemplateSelectorKeyboard(e, promptTextarea);
      if (handled) return;
    }

    if (e.key === "Enter" && e.ctrlKey) {
      submitGoogleQuery();
    }
  });

  // Add input event listener for @ detection
  promptTextarea.addEventListener("input", async (e) => {
    const cursorPos = promptTextarea.selectionStart;
    const textBefore = promptTextarea.value.substring(0, cursorPos);

    // Check if @ was just typed
    const atSymbolIndex = textBefore.lastIndexOf("@");
    if (atSymbolIndex !== -1 && atSymbolIndex === cursorPos - 1) {
      // @ was just typed, show template selector
      templateSelectorActive = true;
      templateSearchQuery = "";
      selectedTemplateIndex = 0;

      const { promptTemplates = [] } = await chrome.storage.sync.get(
        "promptTemplates"
      );
      createTemplateSelector(promptTextarea, promptTemplates);
    } else if (templateSelectorActive && atSymbolIndex !== -1) {
      // Update search query if @ is still present
      templateSearchQuery = textBefore.substring(atSymbolIndex + 1);
      selectedTemplateIndex = 0;

      const { promptTemplates = [] } = await chrome.storage.sync.get(
        "promptTemplates"
      );
      createTemplateSelector(
        promptTextarea,
        promptTemplates,
        templateSearchQuery
      );
    } else if (templateSelectorActive) {
      // @ was deleted, close selector
      closeTemplateSelector();
    }
  });

  // Add voice button listener
  document.getElementById("quickai-voice").addEventListener("click", () => {
    startVoiceRecognition();
  });

  // Load models
  loadModelsForGoogleSearch();
}

// Load models for Google search UI
async function loadModelsForGoogleSearch() {
  const models = await getModels();
  const modelSelect = document.getElementById("quickai-model");

  let lastModel = null;
  try {
    const result = await chrome.storage.sync.get("lastModel");
    lastModel = result.lastModel;
  } catch (error) {
    console.warn("Could not access chrome.storage:", error);
  }

  const defaultModel = lastModel || models[0]?.id || "google/gemini-2.5-flash";

  modelSelect.innerHTML = models
    .map(
      (m) =>
        `<option value="${m.id}" ${m.id === defaultModel ? "selected" : ""}>${
          m.name
        }</option>`
    )
    .join("");

  // Save model selection
  modelSelect.addEventListener("change", (e) => {
    try {
      chrome.storage.sync.set({ lastModel: e.target.value });
    } catch (error) {
      console.warn("Could not save model selection:", error);
    }
  });
}

// Start scraping Google results
async function startScrapingGoogleResults() {
  const progressStatus = document.querySelector(
    ".quickai-google-progress-status"
  );
  const progressBar = document.querySelector(".quickai-google-progress-fill");
  const resultsList = document.getElementById("quickai-google-results");

  if (!googleSearchResults.length) {
    updateGoogleSearchError("No search results to scrape");
    return;
  }

  progressStatus.textContent = `Found ${googleSearchResults.length} results. Starting to scrape content...`;

  // Display results list
  resultsList.innerHTML = googleSearchResults
    .map(
      (result, index) => `
    <div class="quickai-google-result-item" data-index="${index}">
      <div class="quickai-google-result-status pending" id="google-result-${index}"></div>
      <div class="quickai-google-result-title">${escapeHtml(result.title)}</div>
    </div>
  `
    )
    .join("");

  // Scrape each result
  let completed = 0;
  for (let i = 0; i < googleSearchResults.length; i++) {
    const result = googleSearchResults[i];
    const statusElement = document.getElementById(`google-result-${i}`);

    // Update status to loading
    statusElement.className = "quickai-google-result-status loading";

    try {
      // Request scraping from service worker
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "scrapeGoogleResult",
            url: result.url,
            index: i,
          },
          resolve
        );
      });

      if (response && response.success) {
        googleScrapedContent.set(result.url, response.content);
        statusElement.className = "quickai-google-result-status success";
      } else {
        statusElement.className = "quickai-google-result-status error";
      }
    } catch (error) {
      console.error(`Failed to scrape ${result.url}:`, error);
      statusElement.className = "quickai-google-result-status error";
    }

    completed++;
    const progress = (completed / googleSearchResults.length) * 100;
    progressBar.style.width = `${progress}%`;
    progressStatus.textContent = `Scraped ${completed} of ${googleSearchResults.length} results...`;
  }

  // Enable submit button
  const submitBtn = document.getElementById("quickai-submit");
  if (submitBtn) {
    submitBtn.disabled = false;
    progressStatus.textContent = `Completed! Scraped ${googleScrapedContent.size} of ${googleSearchResults.length} results.`;
  }
}

// Submit Google query with scraped content
async function submitGoogleQuery() {
  const prompt = document.getElementById("quickai-prompt").value.trim();
  if (!prompt) return;

  const model = document.getElementById("quickai-model").value;
  const conversationArea = document.getElementById("quickai-conversation");
  const submitBtn = document.getElementById("quickai-submit");
  const promptInput = document.getElementById("quickai-prompt");
  const searchQuery =
    document.getElementById("quickai-container").dataset.googleQuery;

  // Add user message to conversation
  const userMessage = document.createElement("div");
  userMessage.className = "quickai-message quickai-user-message";
  userMessage.innerHTML = `<div class="quickai-message-content">${escapeHtml(
    prompt
  )}</div>`;
  conversationArea.appendChild(userMessage);

  // Clear input
  promptInput.value = "";

  // Add AI message container with loading state
  const aiMessage = document.createElement("div");
  aiMessage.className = "quickai-message quickai-ai-message";
  aiMessage.id = `ai-message-${Date.now()}`;
  aiMessage.innerHTML =
    '<div class="quickai-message-content"><div class="quickai-loader"></div></div>';
  conversationArea.appendChild(aiMessage);

  // Scroll to bottom
  conversationArea.scrollTop = conversationArea.scrollHeight;

  // Store message ID for streaming updates
  const currentMessageId = aiMessage.id;

  submitBtn.disabled = true;
  submitBtn.textContent = "Processing...";

  // Prepare Google search context
  const googleContext = Array.from(googleScrapedContent.entries()).map(
    ([url, content]) => ({
      url,
      title: content.title,
      content: content.content,
    })
  );

  try {
    chrome.runtime.sendMessage({
      type: "queryAIWithGoogle",
      searchQuery: searchQuery,
      googleContext: googleContext,
      prompt: prompt,
      model: model,
      messageId: currentMessageId,
    });
  } catch (error) {
    console.error("Failed to send message to service worker:", error);
    const messageContent = aiMessage.querySelector(".quickai-message-content");
    if (messageContent) {
      messageContent.innerHTML =
        '<div class="quickai-error">Failed to connect to QuickAI service. Please refresh the page and try again.</div>';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
  }
}

// Update Google search error
function updateGoogleSearchError(errorMessage) {
  const progressStatus = document.querySelector(
    ".quickai-google-progress-status"
  );
  if (progressStatus) {
    progressStatus.textContent = errorMessage;
    progressStatus.style.color = "#d32f2f";
  }
}

// Create Google search + screenshots UI
function createGoogleScreenshotUI(rect, searchQuery) {
  if (activeUI) activeUI.remove();

  const container = document.createElement("div");
  container.id = "quickai-container";
  container.className = "quickai-container";

  // Store search query
  container.dataset.googleQuery = searchQuery;
  container.dataset.isGoogleScreenshot = "true";

  // Position near selected text
  const top = window.scrollY + rect.bottom + 10;
  const left = window.scrollX + rect.left;

  container.style.top = `${top}px`;
  container.style.left = `${left}px`;

  container.innerHTML = `
    <div class="quickai-gradient-border"></div>
    <div class="quickai-content">
      <div class="quickai-header">
        <span class="quickai-title">QuickAI - Google Search + Screenshots</span>
        <div class="quickai-header-buttons">
          <button id="quickai-expand" class="quickai-expand" title="Expand">⬜</button>
          <button id="quickai-clear" class="quickai-clear" title="Clear conversation">🗑️</button>
          <button id="quickai-close" class="quickai-close">&times;</button>
        </div>
      </div>
      <div class="quickai-context">
        <strong>Search Query:</strong> <span class="quickai-context-text">${escapeHtml(
          searchQuery.substring(0, 100)
        )}${searchQuery.length > 100 ? "..." : ""}</span>
      </div>
      <div id="quickai-google-screenshot-progress" class="quickai-google-progress">
        <div class="quickai-google-progress-header">
          <div class="quickai-google-icon">ii</div>
          <div class="quickai-google-progress-title">Searching & Capturing Screenshots...</div>
        </div>
        <div class="quickai-google-progress-status">Opening Google search and extracting top 5 results...</div>
        <div class="quickai-google-progress-bar">
          <div class="quickai-google-progress-fill" style="width: 0%"></div>
        </div>
        <div class="quickai-google-screenshot-results" id="quickai-google-screenshot-results"></div>
        <div class="quickai-screenshot-thumbnails" id="quickai-screenshot-thumbnails"></div>
      </div>
      <div id="quickai-conversation" class="quickai-conversation"></div>
      <div class="quickai-input-area">
        <div class="quickai-textarea-wrapper">
          <textarea id="quickai-prompt" class="quickai-prompt" placeholder="Ask about the screenshots from the search results..." rows="3"></textarea>
          <button id="quickai-voice" class="quickai-voice-btn" title="Voice to text" aria-label="Voice to text">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 11C9.66 11 11 9.66 11 8V4C11 2.34 9.66 1 8 1C6.34 1 5 2.34 5 4V8C5 9.66 6.34 11 8 11Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M13 8C13 10.76 10.76 13 8 13C5.24 13 3 10.76 3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 15V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button id="quickai-voice-cleanup" class="quickai-voice-cleanup-btn" title="Voice to text with AI cleanup" aria-label="Voice to text with AI cleanup">
            <span class="quickai-red-dot">·</span>
          </button>
        </div>
        <div class="quickai-controls">
          <select id="quickai-model" class="quickai-model"></select>
          <button id="quickai-submit" class="quickai-submit" disabled>Submit</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);
  activeUI = container;

  // Load models and initialize UI
  loadModelsForGoogleSearch();

  // Add event listeners
  document.getElementById("quickai-close").addEventListener("click", closeUI);
  document
    .getElementById("quickai-clear")
    .addEventListener("click", clearConversation);
  document
    .getElementById("quickai-expand")
    .addEventListener("click", toggleExpand);
  const promptTextarea = document.getElementById("quickai-prompt");
  promptTextarea.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitGoogleScreenshotQuery();
    }
  });

  // Voice button
  const voiceBtn = document.getElementById("quickai-voice");
  if (voiceBtn) {
    voiceBtn.addEventListener("click", startVoiceRecognition);
  }
}

// Display Google screenshot results
function displayGoogleScreenshotResults(results) {
  const progressStatus = document.querySelector(
    ".quickai-google-progress-status"
  );
  const progressBar = document.querySelector(".quickai-google-progress-fill");
  const resultsList = document.getElementById(
    "quickai-google-screenshot-results"
  );
  const thumbnailsContainer = document.getElementById(
    "quickai-screenshot-thumbnails"
  );

  if (!results || !results.screenshots || results.screenshots.length === 0) {
    updateGoogleScreenshotError("No screenshots captured");
    return;
  }

  progressStatus.textContent = `Captured ${results.screenshots.length} screenshots from top search results`;
  progressBar.style.width = "100%";

  // Display results list
  resultsList.innerHTML = results.screenshots
    .map(
      (screenshot, index) => `
    <div class="quickai-google-result-item" data-index="${index}">
      <div class="quickai-google-result-status success"></div>
      <div class="quickai-google-result-title">${escapeHtml(
        screenshot.title
      )}</div>
    </div>
  `
    )
    .join("");

  // Display screenshot thumbnails
  thumbnailsContainer.innerHTML = `
    <div class="quickai-screenshot-grid">
      ${results.screenshots
        .map(
          (screenshot, index) => `
        <div class="quickai-screenshot-thumb" data-index="${index}">
          <img src="${screenshot.data}" alt="${escapeHtml(screenshot.title)}" />
          <div class="quickai-screenshot-title">${escapeHtml(
            screenshot.title
          )}</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  // Store screenshots data for submission
  const container = document.getElementById("quickai-container");
  container.dataset.screenshotsData = JSON.stringify(results.screenshots);

  // Enable submit button
  const submitBtn = document.getElementById("quickai-submit");
  if (submitBtn) {
    submitBtn.disabled = false;
  }

  // Add click handler for submit
  submitBtn.addEventListener("click", submitGoogleScreenshotQuery);
}

// Update Google screenshot error
function updateGoogleScreenshotError(errorMessage) {
  const progressStatus = document.querySelector(
    ".quickai-google-progress-status"
  );
  if (progressStatus) {
    progressStatus.textContent = errorMessage;
    progressStatus.style.color = "#d32f2f";
  }
}

// Submit Google screenshot query
async function submitGoogleScreenshotQuery() {
  const prompt = document.getElementById("quickai-prompt").value.trim();
  if (!prompt) return;

  const model = document.getElementById("quickai-model").value;
  const conversationArea = document.getElementById("quickai-conversation");
  const submitBtn = document.getElementById("quickai-submit");
  const promptInput = document.getElementById("quickai-prompt");
  const searchQuery =
    document.getElementById("quickai-container").dataset.googleQuery;
  const screenshotsData = JSON.parse(
    document.getElementById("quickai-container").dataset.screenshotsData
  );

  // Add user message to conversation
  const userMessage = document.createElement("div");
  userMessage.className = "quickai-message quickai-user-message";
  userMessage.innerHTML = `<div class="quickai-message-content">${escapeHtml(
    prompt
  )}</div>`;
  conversationArea.appendChild(userMessage);

  // Clear input
  promptInput.value = "";

  // Add AI message container with loading state
  const aiMessage = document.createElement("div");
  aiMessage.className = "quickai-message quickai-ai-message";
  const currentMessageId = `ai-message-${Date.now()}`;
  aiMessage.id = currentMessageId;
  aiMessage.innerHTML =
    '<div class="quickai-message-content"><div class="quickai-loader"></div></div>';
  conversationArea.appendChild(aiMessage);
  conversationArea.scrollTop = conversationArea.scrollHeight;

  // Disable submit button
  submitBtn.disabled = true;
  submitBtn.textContent = "Processing...";

  try {
    chrome.runtime.sendMessage({
      type: "queryAIWithMultipleScreenshots",
      searchQuery: searchQuery,
      screenshots: screenshotsData,
      prompt: prompt,
      model: model,
      messageId: currentMessageId,
    });
  } catch (error) {
    console.error("Failed to send message to service worker:", error);
    const messageContent = aiMessage.querySelector(".quickai-message-content");
    if (messageContent) {
      messageContent.innerHTML =
        '<div class="quickai-error">Failed to connect to QuickAI service. Please refresh the page and try again.</div>';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
  }
}

// Debug function to test template loading (accessible from console)
window.debugQuickAITemplates = async function () {
  try {
    const result = await chrome.storage.sync.get("promptTemplates");
    console.log("QuickAI Debug - Storage result:", result);
    console.log("QuickAI Debug - Templates:", result.promptTemplates);
    console.log(
      "QuickAI Debug - Templates length:",
      result.promptTemplates ? result.promptTemplates.length : 0
    );

    // Test creating the selector
    const testTextarea = document.querySelector("#quickai-prompt");
    if (testTextarea && result.promptTemplates) {
      console.log(
        "QuickAI Debug - Testing createTemplateSelector with textarea:",
        testTextarea
      );
      createTemplateSelector(testTextarea, result.promptTemplates || []);
    } else {
      console.log("QuickAI Debug - No QuickAI textarea found or no templates");
    }

    return result.promptTemplates || [];
  } catch (error) {
    console.error("QuickAI Debug - Error:", error);
    return [];
  }
};

// Screenshot functionality
async function initiateScreenshotCapture(rect, contextText) {
  try {
    // Show loading indicator
    const loadingDiv = document.createElement("div");
    loadingDiv.id = "quickai-screenshot-loading";
    loadingDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px 30px;
      border-radius: 8px;
      z-index: 2147483647;
      font-family: Arial, sans-serif;
      font-size: 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    loadingDiv.innerHTML = `
      <div style="display: flex; align-items: center; gap: 15px;">
        <div class="quickai-loading-spinner" style="
          width: 24px;
          height: 24px;
          border: 3px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: quickai-spin 1s linear infinite;
        "></div>
        <span>Capturing full page screenshot...</span>
      </div>
    `;
    document.body.appendChild(loadingDiv);

    // Add spinner animation
    const style = document.createElement("style");
    style.textContent = `
      @keyframes quickai-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    // Request screenshot from service worker
    chrome.runtime.sendMessage(
      {
        type: "captureScreenshot",
      },
      (response) => {
        // Remove loading indicator
        loadingDiv.remove();
        style.remove();

        if (chrome.runtime.lastError) {
          console.error(
            "Failed to capture screenshot:",
            chrome.runtime.lastError
          );
          alert(
            "Failed to capture screenshot: " + chrome.runtime.lastError.message
          );
          return;
        }

        if (response.error && !response.screenshot) {
          console.error("Screenshot error:", response.error);
          alert("Failed to capture screenshot: " + response.error);
          return;
        }

        if (response.screenshot) {
          console.log(
            "Screenshot received, length:",
            response.screenshot.length
          );
          console.log(
            "Screenshot prefix:",
            response.screenshot.substring(0, 50)
          );
          // Create UI for screenshot preview and prompt
          createScreenshotUI(
            rect,
            response.screenshot,
            contextText,
            response.error
          );
        }
      }
    );
  } catch (error) {
    console.error("Error initiating screenshot capture:", error);
    alert("Failed to capture screenshot");
  }
}

// Initiate Google search with screenshots of top 5 results
async function initiateGoogleSearchWithScreenshots(rect, searchQuery) {
  try {
    // Create UI for combined Google search + screenshots
    createGoogleScreenshotUI(rect, searchQuery);

    // Clear previous results
    googleSearchResults = [];
    googleScrapedContent.clear();

    // Request service worker to handle Google search and screenshots
    chrome.runtime.sendMessage(
      {
        type: "performGoogleSearchWithScreenshots",
        query: searchQuery,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Failed to perform Google search with screenshots:",
            chrome.runtime.lastError
          );
          updateGoogleScreenshotError("Failed to perform search");
          return;
        }

        if (response && response.results) {
          displayGoogleScreenshotResults(response.results);
        } else {
          updateGoogleScreenshotError("No results found");
        }
      }
    );
  } catch (error) {
    console.error("Error initiating Google search with screenshots:", error);
    updateGoogleScreenshotError("Search failed");
  }
}

// Create UI for screenshot preview and prompt
async function createScreenshotUI(
  rect,
  screenshotData,
  contextText,
  fallbackError = null
) {
  try {
    if (activeUI) activeUI.remove();

    const container = document.createElement("div");
    container.id = "quickai-container";
    container.className = "quickai-container";

    // Store screenshot data on the container
    container.dataset.screenshotData = screenshotData;
    container.dataset.contextText = contextText || "";
    container.dataset.isScreenshot = "true";

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
    const defaultModel =
      lastModel || models[0]?.id || "google/gemini-2.5-flash";

    // Determine title based on whether it's a full page or fallback
    const screenshotTitle = fallbackError
      ? "QuickAI Screenshot (Visible Area)"
      : "QuickAI Screenshot (Full Page)";

    container.innerHTML = `
      <div class="quickai-gradient-border"></div>
      <div class="quickai-content">
        <div class="quickai-header">
          <span class="quickai-title">${screenshotTitle}</span>
          <div class="quickai-header-buttons">
            <button id="quickai-expand" class="quickai-expand" title="Expand">⬜</button>
            <button id="quickai-clear" class="quickai-clear" title="Clear conversation">🗑️</button>
            <button id="quickai-close" class="quickai-close">&times;</button>
          </div>
        </div>
        ${
          contextText
            ? `
        <div class="quickai-context">
          <strong>Context:</strong> <span class="quickai-context-text">${escapeHtml(
            contextText.substring(0, 100)
          )}${contextText.length > 100 ? "..." : ""}</span>
        </div>
        `
            : ""
        }
        <div class="quickai-screenshot-preview">
          <img src="${screenshotData}" alt="Screenshot preview" style="max-width: 100%; height: auto; max-height: 200px; object-fit: contain;">
        </div>
        <div id="quickai-conversation" class="quickai-conversation"></div>
        <div class="quickai-input-area">
          <div class="quickai-textarea-wrapper">
            <textarea id="quickai-prompt" class="quickai-prompt" placeholder="Ask about this screenshot..." rows="3"></textarea>
            <button id="quickai-voice" class="quickai-voice-btn" title="Voice to text with AI cleanup" aria-label="Voice to text with AI cleanup">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 11C9.66 11 11 9.66 11 8V4C11 2.34 9.66 1 8 1C6.34 1 5 2.34 5 4V8C5 9.66 6.34 11 8 11Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13 8C13 10.76 10.76 13 8 13C5.24 13 3 10.76 3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 13V15M6 15H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="quickai-submit-area">
            <select id="quickai-model-select" class="quickai-model-select">
              ${models
                .map(
                  (model) =>
                    `<option value="${model.id}" ${
                      model.id === defaultModel ? "selected" : ""
                    }>${model.name}</option>`
                )
                .join("")}
            </select>
            <button id="quickai-submit" class="quickai-submit">Send</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    activeUI = container;

    // Set up event handlers
    document.getElementById("quickai-close").addEventListener("click", closeUI);
    document
      .getElementById("quickai-expand")
      .addEventListener("click", toggleExpand);
    document
      .getElementById("quickai-clear")
      .addEventListener("click", clearConversation);
    document
      .getElementById("quickai-submit")
      .addEventListener("click", handleScreenshotSubmit);

    const promptTextarea = document.getElementById("quickai-prompt");
    const modelSelect = document.getElementById("quickai-model-select");

    // Save selected model
    modelSelect.addEventListener("change", async () => {
      const selectedModel = modelSelect.value;
      try {
        await chrome.storage.sync.set({ lastModel: selectedModel });
      } catch (error) {
        console.warn("Could not save model preference:", error);
      }
    });

    // Submit handler for Enter key
    promptTextarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleScreenshotSubmit();
      }
    });

    // Add voice button listener
    document.getElementById("quickai-voice").addEventListener("click", () => {
      startVoiceRecognition();
    });

    // Focus on prompt
    promptTextarea.focus();
  } catch (error) {
    console.error("Error creating screenshot UI:", error);
  }
}

// Handle screenshot submit
async function handleScreenshotSubmit() {
  const container = document.getElementById("quickai-container");
  if (!container) return;

  const promptTextarea = container.querySelector("#quickai-prompt");
  const prompt = promptTextarea.value.trim();

  if (!prompt) {
    promptTextarea.focus();
    return;
  }

  const submitBtn = container.querySelector("#quickai-submit");
  const modelSelect = container.querySelector("#quickai-model-select");
  const conversationArea = container.querySelector("#quickai-conversation");
  const screenshotData = container.dataset.screenshotData;
  const contextText = container.dataset.contextText;

  console.log(
    "Screenshot data from container:",
    screenshotData ? screenshotData.substring(0, 50) + "..." : "null"
  );

  if (!screenshotData) {
    alert("Screenshot data is missing. Please try again.");
    return;
  }

  // Disable inputs during processing
  promptTextarea.disabled = true;
  submitBtn.disabled = true;
  submitBtn.dataset.originalText = submitBtn.textContent;
  submitBtn.textContent = "Sending...";

  // Add user message to conversation
  const userMessageDiv = document.createElement("div");
  userMessageDiv.className = "quickai-message quickai-user-message";
  userMessageDiv.innerHTML = `
    <div class="quickai-message-header">You</div>
    <div class="quickai-message-content">${escapeHtml(prompt)}</div>
  `;
  conversationArea.appendChild(userMessageDiv);

  // Add AI message placeholder
  const currentMessageId = Date.now().toString();
  const aiMessageDiv = document.createElement("div");
  aiMessageDiv.className = "quickai-message quickai-ai-message";
  aiMessageDiv.id = currentMessageId;
  aiMessageDiv.innerHTML = `
    <div class="quickai-message-header">
      <span class="quickai-ai-label">AI</span>
      <span class="quickai-model-label">${
        modelSelect.options[modelSelect.selectedIndex].text
      }</span>
    </div>
    <div class="quickai-message-content">
      <div class="quickai-loading-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  conversationArea.appendChild(aiMessageDiv);

  // Scroll to bottom
  conversationArea.scrollTop = conversationArea.scrollHeight;

  // Clear input
  promptTextarea.value = "";

  const model = modelSelect.value;

  try {
    console.log("Sending screenshot query with messageId:", currentMessageId);
    console.log("Screenshot length being sent:", screenshotData.length);
    chrome.runtime.sendMessage({
      type: "queryAIWithScreenshot",
      screenshot: screenshotData,
      contextText: contextText,
      prompt: prompt,
      model: model,
      messageId: currentMessageId,
    });

    // Save to conversation history
    const historyItem = {
      id: currentMessageId,
      type: "screenshot",
      contextText: contextText,
      screenshot: screenshotData.substring(0, 100) + "...", // Don't store full screenshot in history
      prompt: prompt,
      model: model,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
    };

    conversationHistory.push(historyItem);
    chrome.storage.local.get(["conversations"], (result) => {
      const conversations = result.conversations || [];
      conversations.push(historyItem);
      chrome.storage.local.set({ conversations });
    });
  } catch (error) {
    console.error("Error sending screenshot query:", error);
    const messageContent = aiMessageDiv.querySelector(
      ".quickai-message-content"
    );
    messageContent.innerHTML = `<div class="quickai-error">Error: ${error.message}</div>`;
  } finally {
    // Re-enable inputs after sending
    setTimeout(() => {
      promptTextarea.disabled = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Send";
      promptTextarea.focus();
    }, 100);
  }
}
