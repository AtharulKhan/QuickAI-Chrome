// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'queryAI') {
        handleAIQuery(message, sender.tab.id);
        return true;
    } else if (message.type === 'fetchAndSummarizeLink') {
        handleLinkSummarization(message, sender.tab.id);
        return true;
    } else if (message.type === 'summarizeLinkWithContent') {
        handleLinkSummarizationWithContent(message, sender.tab.id);
        return true;
    } else if (message.type === 'scrapeInBackgroundTab') {
        handleBackgroundTabScrape(message, sendResponse);
        return true; // Will respond asynchronously
    } else if (message.type === 'getTabs') {
        handleGetTabs(sendResponse);
        return true; // Will respond asynchronously
    } else if (message.type === 'scrapeMultipleTabs') {
        handleScrapeMultipleTabs(message, sendResponse);
        return true; // Will respond asynchronously
    }
});

// Process AI query with streaming
async function handleAIQuery(message, tabId) {
    try {
        // Get API key from storage
        const { apiKey } = await chrome.storage.sync.get('apiKey');
        
        if (!apiKey) {
            chrome.tabs.sendMessage(tabId, {
                type: 'streamError',
                error: 'API key not configured. Please set your OpenRouter API key in the extension options.'
            });
            return;
        }

        // Notify start of streaming
        chrome.tabs.sendMessage(tabId, { 
            type: 'streamStart',
            messageId: message.messageId 
        });

        // Build system message with context
        let systemMessage = `You are a helpful AI assistant. The user has selected the following text from a webpage: "${message.context}".`;
        
        // Add surrounding context if available
        if (message.fullContext) {
            systemMessage += `\n\nHere is additional context from the surrounding paragraphs:`;
            if (message.fullContext.before) {
                systemMessage += `\nBefore the selection:\n${message.fullContext.before}`;
            }
            if (message.fullContext.after) {
                systemMessage += `\nAfter the selection:\n${message.fullContext.after}`;
            }
        }
        
        // Add full page context if enabled
        if (message.includePageContext && message.pageContent) {
            systemMessage += `\n\nFull Page Context:`;
            systemMessage += `\nPage Title: ${message.pageContent.title}`;
            systemMessage += `\nPage URL: ${message.pageContent.url}`;
            systemMessage += `\nPage Content:\n${message.pageContent.content}`;
            
            if (message.pageContent.truncated) {
                systemMessage += `\n\n[Note: Page content was truncated due to length]`;
            }
            
            systemMessage += `\n\nPlease use the full page context to provide more comprehensive and accurate answers. Consider the selected text within the broader context of the entire page.`;
        } else {
            systemMessage += `\n\nPlease provide helpful, relevant, and concise responses based on this context. Focus primarily on the selected text${message.fullContext ? ', but use the surrounding context to better understand the topic' : ''}.`;
        }
        
        // Add tab contexts if available
        if (message.tabContexts && message.tabContexts.length > 0) {
            systemMessage += `\n\nAdditional Context from Other Browser Tabs:`;
            message.tabContexts.forEach((tabContext, index) => {
                systemMessage += `\n\n--- Tab ${index + 1}: ${tabContext.title} ---`;
                systemMessage += `\nURL: ${tabContext.url}`;
                systemMessage += `\nContent:\n${tabContext.content}`;
            });
            systemMessage += `\n\nPlease consider the information from these additional tabs to provide a more comprehensive and contextual response. These tabs were specifically selected by the user as relevant to their query.`;
        }
        

        // Make API request
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/QuickAI',
                'X-Title': 'QuickAI Chrome Extension'
            },
            body: JSON.stringify({
                model: message.model,
                messages: [
                    {
                        role: 'system',
                        content: systemMessage
                    },
                    {
                        role: 'user',
                        content: message.prompt
                    }
                ],
                stream: true,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API Error: ${response.status} - ${error}`);
        }

        // Process streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        break;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        
                        if (content) {
                            fullResponse += content;
                            // Send formatted chunk to content script
                            const formattedContent = formatMarkdown(content);
                            chrome.tabs.sendMessage(tabId, {
                                type: 'streamChunk',
                                content: formattedContent,
                                rawContent: content, // Send raw content for copying
                                messageId: message.messageId
                            });
                        }
                    } catch (e) {
                        console.error('Error parsing stream data:', e);
                    }
                }
            }
        }

        // Save to history with enhanced fields
        await saveToHistory({
            context: message.context,
            prompt: message.prompt,
            response: fullResponse,
            model: message.model,
            timestamp: new Date().toISOString(),
            favorite: false,
            tags: [],
            title: ''
        });

        // Notify completion
        chrome.tabs.sendMessage(tabId, { 
            type: 'streamEnd',
            messageId: message.messageId 
        });

    } catch (error) {
        console.error('QuickAI Error:', error);
        chrome.tabs.sendMessage(tabId, {
            type: 'streamError',
            error: error.message,
            messageId: message.messageId
        });
    }
}

// Save conversation to history
async function saveToHistory(conversation) {
    try {
        const { history = [] } = await chrome.storage.local.get('history');
        
        // Add new conversation to beginning
        history.unshift(conversation);
        
        // Keep only last 100 conversations
        if (history.length > 100) {
            history.splice(100);
        }
        
        await chrome.storage.local.set({ history });
    } catch (error) {
        console.error('Failed to save conversation to history:', error);
        // Check for quota exceeded error
        if (error.message && error.message.includes('QUOTA_BYTES')) {
            console.error('Storage quota exceeded. Consider reducing history size.');
        }
    }
}

// Simple markdown formatter
function formatMarkdown(text) {
    // This is a simplified version - in production you'd want a proper markdown parser
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
    // Set default settings
    chrome.storage.sync.get(['apiKey'], (result) => {
        if (!result.apiKey) {
            // Open options page on first install
            chrome.runtime.openOptionsPage();
        }
    });
    
    // Create context menu
    chrome.contextMenus.create({
        id: "quickai-context",
        title: "Ask QuickAI about '%s'",
        contexts: ["selection"]
    });
});

// Handle link summarization
async function handleLinkSummarization(message, tabId) {
    try {
        const { linkUrl, linkText, model, messageId } = message;
        
        // Get API key from storage
        const { apiKey } = await chrome.storage.sync.get('apiKey');
        
        if (!apiKey) {
            chrome.tabs.sendMessage(tabId, {
                type: 'streamError',
                error: 'API key not configured. Please set your OpenRouter API key in the extension options.',
                messageId
            });
            return;
        }

        // Notify start of streaming
        chrome.tabs.sendMessage(tabId, { 
            type: 'streamStart',
            messageId 
        });

        // Try to fetch link content
        let linkContent = null;
        let fetchError = null;
        
        try {
            // Attempt to fetch the page content
            const response = await fetch(linkUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            
            if (response.ok) {
                const html = await response.text();
                linkContent = extractContentFromHtml(html, linkUrl);
            } else {
                fetchError = `Failed to fetch (${response.status})`;
            }
        } catch (error) {
            fetchError = `Network error: ${error.message}`;
            console.error('Failed to fetch link:', error);
        }

        // Build prompt for summarization
        let systemMessage = `You are a helpful AI assistant specialized in summarizing web content. `;
        
        if (linkContent) {
            systemMessage += `Here is the content from the link "${linkUrl}":

Title: ${linkContent.title || 'N/A'}
Description: ${linkContent.description || 'N/A'}

Content:
${linkContent.content}

Please provide a concise summary of this webpage, highlighting the main points and key information.`;
        } else {
            systemMessage += `The user wants to know about this link: "${linkUrl}" (${linkText})
            
Unfortunately, I couldn't fetch the actual content due to: ${fetchError}. 
Please provide any relevant information you might have about this URL or topic based on the link text and URL pattern.`;
        }

        // Make API request
        const apiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/QuickAI',
                'X-Title': 'QuickAI Chrome Extension'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: systemMessage
                    },
                    {
                        role: 'user',
                        content: 'Please summarize this webpage content concisely.'
                    }
                ],
                stream: true,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!apiResponse.ok) {
            const error = await apiResponse.text();
            throw new Error(`API Error: ${apiResponse.status} - ${error}`);
        }

        // Process streaming response
        const reader = apiResponse.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        break;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        
                        if (content) {
                            fullResponse += content;
                            const formattedContent = formatMarkdown(content);
                            chrome.tabs.sendMessage(tabId, {
                                type: 'streamChunk',
                                content: formattedContent,
                                rawContent: content,
                                messageId
                            });
                        }
                    } catch (e) {
                        console.error('Error parsing stream data:', e);
                    }
                }
            }
        }

        // Notify completion
        chrome.tabs.sendMessage(tabId, { 
            type: 'streamEnd',
            messageId 
        });

    } catch (error) {
        console.error('QuickAI Link Error:', error);
        chrome.tabs.sendMessage(tabId, {
            type: 'streamError',
            error: error.message,
            messageId: message.messageId
        });
    }
}

// Extract content from HTML
function extractContentFromHtml(html, url) {
    try {
        // Create a DOM parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Extract metadata
        const title = doc.querySelector('title')?.textContent || 
                     doc.querySelector('meta[property="og:title"]')?.content || '';
        
        const description = doc.querySelector('meta[name="description"]')?.content || 
                           doc.querySelector('meta[property="og:description"]')?.content || '';
        
        // Remove unwanted elements
        const elementsToRemove = [
            'script', 'style', 'nav', 'header', 'footer', 
            'aside', '.sidebar', '.advertisement', '.ads',
            '#comments', '.comments', '.cookie-notice'
        ];
        
        elementsToRemove.forEach(selector => {
            doc.querySelectorAll(selector).forEach(el => el.remove());
        });
        
        // Try to find main content
        const contentSelectors = [
            'main', 'article', '[role="main"]', 
            '#main', '.main', '#content', '.content',
            '.article-body', '.post-content', '.entry-content'
        ];
        
        let mainContent = null;
        for (const selector of contentSelectors) {
            mainContent = doc.querySelector(selector);
            if (mainContent) break;
        }
        
        // Fallback to body if no main content found
        if (!mainContent) {
            mainContent = doc.body;
        }
        
        // Extract text content
        let textContent = '';
        const walker = document.createTreeWalker(
            mainContent,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (node.textContent.trim().length === 0) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        
        const textParts = [];
        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text) {
                textParts.push(text);
            }
        }
        
        textContent = textParts.join(' ');
        
        // Limit content length
        const maxLength = 5000;
        if (textContent.length > maxLength) {
            textContent = textContent.substring(0, maxLength) + '... [content truncated]';
        }
        
        return {
            title,
            description,
            content: textContent,
            url
        };
        
    } catch (error) {
        console.error('Error extracting content from HTML:', error);
        return null;
    }
}

// Handle link summarization with scraped content
async function handleLinkSummarizationWithContent(message, tabId) {
    try {
        const { linkUrl, linkText, scrapedContent, model, messageId } = message;
        
        // Get API key from storage
        const { apiKey } = await chrome.storage.sync.get('apiKey');
        
        if (!apiKey) {
            chrome.tabs.sendMessage(tabId, {
                type: 'streamError',
                error: 'API key not configured. Please set your OpenRouter API key in the extension options.',
                messageId
            });
            return;
        }

        // Notify start of streaming
        chrome.tabs.sendMessage(tabId, { 
            type: 'streamStart',
            messageId 
        });

        // Build prompt based on whether we have content
        let systemMessage = `You are a helpful AI assistant specialized in summarizing web content. `;
        
        if (scrapedContent && scrapedContent.content) {
            // We have scraped content
            systemMessage += `Here is the content from the link "${linkUrl}":

Title: ${scrapedContent.title || 'N/A'}
Description: ${scrapedContent.description || 'N/A'}

Content:
${scrapedContent.content}

Please provide a concise summary of this webpage, highlighting the main points and key information. Focus on:
1. The main topic or purpose
2. Key points or findings
3. Important details or recommendations
4. Any actionable items`;
        } else {
            // No content available - use AI knowledge
            systemMessage += `The user wants to know about this link: "${linkUrl}" (${linkText})

Based on the URL and link text, please provide:
1. What this page is likely about
2. What kind of content/information it might contain
3. Any relevant context about the website or topic
4. General information that might be helpful

Note: I couldn't access the actual page content due to technical limitations.`;
        }

        // Make API request
        const apiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/QuickAI',
                'X-Title': 'QuickAI Chrome Extension'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: systemMessage
                    },
                    {
                        role: 'user',
                        content: 'Please provide a clear and concise summary.'
                    }
                ],
                stream: true,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!apiResponse.ok) {
            const error = await apiResponse.text();
            throw new Error(`API Error: ${apiResponse.status} - ${error}`);
        }

        // Process streaming response
        const reader = apiResponse.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        break;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        
                        if (content) {
                            fullResponse += content;
                            const formattedContent = formatMarkdown(content);
                            chrome.tabs.sendMessage(tabId, {
                                type: 'streamChunk',
                                content: formattedContent,
                                rawContent: content,
                                messageId
                            });
                        }
                    } catch (e) {
                        console.error('Error parsing stream data:', e);
                    }
                }
            }
        }

        // Notify completion
        chrome.tabs.sendMessage(tabId, { 
            type: 'streamEnd',
            messageId 
        });

    } catch (error) {
        console.error('QuickAI Link Error:', error);
        chrome.tabs.sendMessage(tabId, {
            type: 'streamError',
            error: error.message,
            messageId: message.messageId
        });
    }
}

// Handle background tab scraping for cross-origin links
async function handleBackgroundTabScrape(message, sendResponse) {
    const { url } = message;
    
    try {
        console.log('📋 Service Worker - Opening background tab for:', url);
        
        // Create a new tab in the background
        const tab = await chrome.tabs.create({
            url: url,
            active: false
        });
        
        // Wait for the tab to load
        await new Promise((resolve) => {
            const listener = (tabId, changeInfo) => {
                if (tabId === tab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            
            // Timeout after 10 seconds
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }, 10000);
        });
        
        // Inject script to extract content
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractPageContent,
            args: [url]
        });
        
        // Close the tab
        await chrome.tabs.remove(tab.id);
        
        if (results && results[0] && results[0].result) {
            console.log('✅ Service Worker - Content extracted successfully');
            sendResponse({ success: true, data: results[0].result });
        } else {
            console.error('❌ Service Worker - Failed to extract content');
            sendResponse({ success: false, error: 'Failed to extract content from page' });
        }
        
    } catch (error) {
        console.error('❌ Service Worker - Error in background tab scrape:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Function to inject and extract content from the page
function extractPageContent(url) {
    try {
        // Extract metadata
        const title = document.title || '';
        const metaDesc = document.querySelector('meta[name="description"]');
        const description = metaDesc?.content || '';
        
        // Remove unwanted elements
        const clonedDoc = document.cloneNode(true);
        const unwantedSelectors = [
            'script', 'style', 'nav', 'header', 'footer',
            'aside', '.sidebar', '.advertisement', '.ads',
            '#comments', '.comments', '.cookie', '.modal'
        ];
        
        unwantedSelectors.forEach(selector => {
            clonedDoc.querySelectorAll(selector).forEach(el => el.remove());
        });
        
        // Find main content
        const contentSelectors = [
            // Reddit specific
            '[data-testid="post-container"]',
            '.Post',
            '[slot="post-container"]',
            '.ListingLayout-outerContainer',
            'shreddit-post',
            // General selectors
            'main', 
            'article', 
            '[role="main"]',
            '#main', 
            '.main', 
            '#content', 
            '.content',
            '.post-content', 
            '.entry-content', 
            '.article-body',
            '.markdown-body',
            '.article-content'
        ];
        
        let mainContent = null;
        let selectedSelector = null;
        for (const selector of contentSelectors) {
            mainContent = clonedDoc.querySelector(selector);
            if (mainContent) {
                selectedSelector = selector;
                break;
            }
        }
        
        if (!mainContent) {
            mainContent = clonedDoc.body || clonedDoc;
            selectedSelector = 'body (fallback)';
        }
        
        // Extract text
        const textContent = mainContent.textContent
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 10000);
        
        return {
            title,
            description,
            content: textContent,
            url,
            debug: {
                selector: selectedSelector,
                contentLength: textContent.length
            }
        };
    } catch (error) {
        return {
            title: '',
            description: '',
            content: '',
            url,
            error: error.message
        };
    }
}

// Handle get tabs request
async function handleGetTabs(sendResponse) {
    try {
        const tabs = await chrome.tabs.query({});
        
        // Filter out chrome:// and other special URLs
        const filteredTabs = tabs.filter(tab => {
            return tab.url && 
                   !tab.url.startsWith('chrome://') && 
                   !tab.url.startsWith('chrome-extension://') &&
                   !tab.url.startsWith('about:') &&
                   !tab.url.startsWith('edge://');
        });
        
        sendResponse({ 
            success: true, 
            tabs: filteredTabs.map(tab => ({
                id: tab.id,
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl
            }))
        });
    } catch (error) {
        console.error('Failed to get tabs:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Handle scrape multiple tabs request
async function handleScrapeMultipleTabs(message, sendResponse) {
    const { tabIds } = message;
    const results = [];
    
    try {
        for (const tabId of tabIds) {
            try {
                // Check if tab still exists
                const tab = await chrome.tabs.get(tabId);
                
                // Skip if URL is not accessible
                if (!tab.url || 
                    tab.url.startsWith('chrome://') || 
                    tab.url.startsWith('chrome-extension://')) {
                    results.push({
                        tabId,
                        success: false,
                        error: 'Cannot access this type of URL'
                    });
                    continue;
                }
                
                // Execute content extraction script
                const injectionResults = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: extractPageContent,
                    args: [tab.url]
                });
                
                if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                    results.push({
                        tabId,
                        success: true,
                        content: injectionResults[0].result
                    });
                } else {
                    results.push({
                        tabId,
                        success: false,
                        error: 'Failed to extract content'
                    });
                }
            } catch (error) {
                console.error(`Failed to scrape tab ${tabId}:`, error);
                results.push({
                    tabId,
                    success: false,
                    error: error.message
                });
            }
        }
        
        sendResponse({ success: true, results });
    } catch (error) {
        console.error('Failed to scrape tabs:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    console.log('Context menu clicked:', info);
    if (info.menuItemId === "quickai-context" && info.selectionText) {
        chrome.tabs.sendMessage(tab.id, {
            type: 'createUIFromContextMenu',
            text: info.selectionText
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Error sending message:', chrome.runtime.lastError);
            }
        });
    }
});