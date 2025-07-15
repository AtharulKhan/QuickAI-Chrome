# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
QuickAI is a Chrome Extension (Manifest V3) that provides instant AI assistance by selecting text with Alt key. It uses vanilla JavaScript without any build tools or package managers.

## Architecture

### Core Components
1. **service-worker.js** - Background script handling:
   - OpenRouter API calls with streaming responses
   - Message routing between content script and API
   - Conversation history management (stored in chrome.storage.sync)
   - Context menu integration

2. **content-script.js** - Page interaction handling:
   - Text selection detection with Alt key
   - Floating UI creation and positioning
   - Streaming response display with markdown formatting
   - Model selection persistence
   - In-place text replacement for editable elements

3. **models.js** - AI model configuration:
   - Centralized list of available models
   - Easy to add/remove models by editing the array

### Chrome Extension Structure
- Uses Manifest V3 with service worker architecture
- No build process - files are loaded directly
- Permissions: storage, sidePanel, activeTab, contextMenus
- Host permission: https://openrouter.ai/*

## Features

### In-Place Text Replacement
- A "Replace" button appears alongside the AI response when near any editable element
- Works in two modes:
  1. **With Selection**: Replaces the selected text with the AI's response
  2. **Without Selection**: Appends or inserts the AI's response into the nearest text field
- Automatically detects the closest editable element on the page
- Supported elements:
  - Standard `<textarea>` and `<input>` elements
  - ContentEditable elements (Gmail, Google Docs, etc.)
- Features:
  - Maintains undo/redo history
  - Shows visual feedback on success/failure
  - Smart insertion - adds appropriate spacing when appending text
  - Works even when no text is selected

## Key Development Commands

### Loading the Extension
```bash
# No build required - load directly in Chrome:
# 1. Open chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select the project directory
```

### Testing Changes
- Content script changes: Reload the webpage
- Service worker changes: Click "Update" in chrome://extensions/
- Manifest changes: Reload the extension in chrome://extensions/

### Debugging
- Content script logs: Open DevTools on any webpage
- Service worker logs: Click "Service Worker" link in chrome://extensions/
- Storage inspection: Use Chrome DevTools Application tab

## Important Implementation Details

### API Integration
- Uses OpenRouter API for multi-model support
- API key stored in chrome.storage.sync (encrypted by Chrome)
- Streaming responses processed line-by-line with SSE format
- Error handling for API failures and missing API key

### UI Positioning
- Floating UI positioned relative to selected text using getBoundingClientRect()
- Handles viewport boundaries to keep UI visible
- Click-outside detection to close UI

### Model Loading
- Models dynamically loaded from models.js using fetch()
- Safe parsing with regex to extract models array
- Fallback to hardcoded models if loading fails

### Message Passing
- Content script → Service worker: chrome.runtime.sendMessage()
- Service worker → Content script: chrome.tabs.sendMessage()
- Message types: queryAI, streamStart, streamChunk, streamEnd, streamError

## Adding New Features

### To Add a New AI Model
Edit models.js:
```javascript
{ id: "provider/model-name", name: "Display Name" }
```

### To Modify the UI
- Styles: Edit content.css
- Structure: Modify createFloatingUI() in content-script.js:61
- Positioning: Adjust calculations in createFloatingUI()

### To Change API Behavior
- Request parameters: Modify fetch body in service-worker.js:35
- Response processing: Update stream parsing in service-worker.js:64-98
- Error handling: Enhance error messages in handleAIQuery()

## Common Issues and Solutions

1. **Extension not loading**: Check manifest.json syntax
2. **API calls failing**: Verify API key in options, check OpenRouter status
3. **UI not appearing**: Check content script injection, verify text selection
4. **Streaming not working**: Ensure proper SSE parsing in service worker
5. **Replace button not appearing**: Ensure text is selected within an editable element
6. **Replace failing**: Check if the editable element still contains the original text
7. **Gmail issues**: The extension uses special Gmail-specific handling for compose areas
8. **Google Docs**: Due to Docs' security model, the Replace button copies text to clipboard instead