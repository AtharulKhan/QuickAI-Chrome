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
    } else if (message.type === 'performGoogleSearch') {
        handleGoogleSearch(message, sendResponse);
        return true; // Will respond asynchronously
    } else if (message.type === 'scrapeGoogleResult') {
        handleGoogleResultScrape(message, sendResponse);
        return true; // Will respond asynchronously
    } else if (message.type === 'queryAIWithGoogle') {
        handleAIQueryWithGoogle(message, sender.tab.id);
        return true;
    } else if (message.type === 'captureScreenshot') {
        handleScreenshotCapture(sender.tab.id, sendResponse);
        return true; // Will respond asynchronously
    } else if (message.type === 'queryAIWithScreenshot') {
        handleAIQueryWithScreenshot(message, sender.tab.id);
        return true;
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
        let systemMessage = `You are a helpful AI assistant. Always format your responses using proper Markdown formatting including:
- **Bold** for emphasis
- *Italics* for subtle emphasis
- Bullet points and numbered lists
- \`code blocks\` for technical terms
- Proper headings with ## and ###
- Line breaks for readability

The user has selected the following text from a webpage: "${message.context}".`;
        
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
        let systemMessage = `You are a helpful AI assistant specialized in summarizing web content. Always format your responses using proper Markdown formatting including:
- **Bold** for emphasis
- *Italics* for subtle emphasis  
- Bullet points and numbered lists
- \`code blocks\` for technical terms
- Proper headings with ## and ###
- Line breaks for readability

`;
        
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
        let systemMessage = `You are a helpful AI assistant specialized in summarizing web content. Always format your responses using proper Markdown formatting including:
- **Bold** for emphasis
- *Italics* for subtle emphasis
- Bullet points and numbered lists
- \`code blocks\` for technical terms
- Proper headings with ## and ###
- Line breaks for readability

`;
        
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

// Handle Google search
async function handleGoogleSearch(message, sendResponse) {
    const { query, url } = message;
    
    try {
        console.log('🔍 Service Worker - Performing Google search for:', query);
        
        // Create a new tab with Google search
        console.log('🔍 Opening Google search URL:', url);
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
        
        // Add a small delay to ensure page is fully rendered
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('🔍 Extracting search results from tab:', tab.id);
        
        // Extract search results
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractGoogleSearchResults
        });
        
        // Close the tab
        await chrome.tabs.remove(tab.id);
        
        if (results && results[0] && results[0].result) {
            console.log('✅ Service Worker - Google search extracted successfully');
            sendResponse({ success: true, results: results[0].result });
        } else {
            console.error('❌ Service Worker - Failed to extract Google results');
            sendResponse({ success: false, error: 'Failed to extract search results' });
        }
        
    } catch (error) {
        console.error('❌ Service Worker - Error in Google search:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Function to extract Google search results
function extractGoogleSearchResults() {
    try {
        console.log('🔍 Extracting from URL:', window.location.href);
        console.log('🔍 Page title:', document.title);
        
        const results = [];
        
        // Multiple possible selectors for Google search results
        const resultSelectors = [
            'div.g',
            'div[data-sokoban-container]',
            'div.tF2Cxc',
            'div.kvH3mc',
            'div[jscontroller][jsaction][jsname][data-hveid]'
        ];
        
        let resultElements = [];
        for (const selector of resultSelectors) {
            resultElements = document.querySelectorAll(selector);
            console.log(`🔍 Selector "${selector}" found:`, resultElements.length, 'elements');
            if (resultElements.length > 0) break;
        }
        
        // If still no results, try to find any links with h3
        if (resultElements.length === 0) {
            console.log('🔍 Fallback: Looking for any h3 with links');
            const h3Elements = document.querySelectorAll('h3');
            resultElements = Array.from(h3Elements).map(h3 => h3.closest('div')).filter(Boolean);
        }
        
        console.log('🔍 Total search result elements found:', resultElements.length);
        
        resultElements.forEach((element, index) => {
            if (index >= 10) return; // Limit to 10 results
            
            // Try multiple selectors for links
            const linkSelectors = [
                'a[href][data-ved]',
                'a[href][jsname]',
                'h3 a[href]',
                'a[href] h3',
                'a[ping]',
                'div[data-hveid] a[href]',
                'a[href]:not([href*="google.com"])'
            ];
            let linkElement = null;
            let url = null;
            
            for (const selector of linkSelectors) {
                linkElement = element.querySelector(selector);
                if (linkElement) {
                    url = linkElement.href || linkElement.parentElement?.href;
                    if (url && !url.includes('google.com')) break;
                }
            }
            
            // If still no URL, try to find any anchor tag
            if (!url) {
                const anyLink = element.querySelector('a[href]');
                if (anyLink && anyLink.href && !anyLink.href.includes('google.com')) {
                    url = anyLink.href;
                }
            }
            
            // Extract title - try multiple selectors
            const titleSelectors = ['h3', 'h3.LC20lb', 'h3.r', 'div[role="heading"]'];
            let title = '';
            for (const selector of titleSelectors) {
                const titleElement = element.querySelector(selector);
                if (titleElement?.textContent) {
                    title = titleElement.textContent;
                    break;
                }
            }
            
            // Extract snippet - try multiple selectors
            const snippetSelectors = [
                'div.VwiC3b',
                'span.aCOpRe',
                'div[data-content-feature="1"]',
                'div.IsZvec',
                'span.st'
            ];
            let snippet = '';
            for (const selector of snippetSelectors) {
                const snippetElement = element.querySelector(selector);
                if (snippetElement?.textContent) {
                    snippet = snippetElement.textContent;
                    break;
                }
            }
            
            if (url && title && !url.includes('google.com') && !url.includes('googleusercontent.com')) {
                results.push({
                    url: url,
                    title: title.trim(),
                    snippet: snippet.trim()
                });
                console.log('Added result:', title, url);
            }
        });
        
        console.log('Total results extracted:', results.length);
        
        // If no results found with structured extraction, fallback to extracting all links
        if (results.length === 0) {
            console.log('🔍 Fallback: Extracting all non-Google links from page');
            const allLinks = document.querySelectorAll('a[href]');
            const uniqueUrls = new Set();
            
            allLinks.forEach(link => {
                const url = link.href;
                const text = link.textContent?.trim() || '';
                
                // Filter out Google URLs, anchors, and javascript
                if (url && 
                    !url.includes('google.com') && 
                    !url.includes('googleapis.com') &&
                    !url.startsWith('javascript:') &&
                    !url.startsWith('#') &&
                    url.startsWith('http') &&
                    text.length > 10 &&
                    !uniqueUrls.has(url)) {
                    
                    uniqueUrls.add(url);
                    results.push({
                        url: url,
                        title: text.substring(0, 100),
                        snippet: ''
                    });
                    
                    if (results.length >= 10) return;
                }
            });
            
            console.log('🔍 Fallback extracted:', results.length, 'links');
        }
        
        return results;
    } catch (error) {
        console.error('Error extracting Google results:', error);
        return [];
    }
}

// Handle Google result scraping
async function handleGoogleResultScrape(message, sendResponse) {
    const { url, index } = message;
    
    try {
        console.log(`📋 Service Worker - Scraping Google result ${index}:`, url);
        
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
            
            // Timeout after 8 seconds
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }, 8000);
        });
        
        // Extract content
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractPageContent,
            args: [url]
        });
        
        // Close the tab
        await chrome.tabs.remove(tab.id);
        
        if (results && results[0] && results[0].result) {
            console.log(`✅ Service Worker - Content extracted successfully for result ${index}`);
            sendResponse({ success: true, content: results[0].result });
        } else {
            console.error(`❌ Service Worker - Failed to extract content for result ${index}`);
            sendResponse({ success: false, error: 'Failed to extract content' });
        }
        
    } catch (error) {
        console.error(`❌ Service Worker - Error scraping result ${index}:`, error);
        sendResponse({ success: false, error: error.message });
    }
}

// Handle AI query with Google search context
async function handleAIQueryWithGoogle(message, tabId) {
    try {
        // Get API key from storage
        const { apiKey } = await chrome.storage.sync.get('apiKey');
        
        if (!apiKey) {
            chrome.tabs.sendMessage(tabId, {
                type: 'streamError',
                error: 'API key not configured. Please set your OpenRouter API key in the extension options.',
                messageId: message.messageId
            });
            return;
        }

        // Notify start of streaming
        chrome.tabs.sendMessage(tabId, { 
            type: 'streamStart',
            messageId: message.messageId 
        });

        // Build system message with Google search context
        let systemMessage = `You are a helpful AI assistant. Always format your responses using proper Markdown formatting including:
- **Bold** for emphasis
- *Italics* for subtle emphasis
- Bullet points and numbered lists
- \`code blocks\` for technical terms
- Proper headings with ## and ###
- Line breaks for readability

The user performed a Google search for: "${message.searchQuery}".`;
        
        // Add Google search results context
        if (message.googleContext && message.googleContext.length > 0) {
            systemMessage += `\n\nI have scraped content from ${message.googleContext.length} Google search results. Here is the content from each page:\n`;
            
            message.googleContext.forEach((result, index) => {
                systemMessage += `\n\n--- Result ${index + 1}: ${result.title} ---`;
                systemMessage += `\nURL: ${result.url}`;
                systemMessage += `\nContent:\n${result.content}`;
            });
            
            systemMessage += `\n\nPlease use this information from the Google search results to provide a comprehensive and accurate response to the user's query. The user searched for "${message.searchQuery}" and now wants to know: "${message.prompt}"`;
        } else {
            systemMessage += `\n\nUnfortunately, I couldn't scrape content from the search results, but the user searched for "${message.searchQuery}" and now wants to know: "${message.prompt}". Please provide the best answer you can based on your knowledge.`;
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
                max_tokens: 2000
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
                            const formattedContent = formatMarkdown(content);
                            chrome.tabs.sendMessage(tabId, {
                                type: 'streamChunk',
                                content: formattedContent,
                                rawContent: content,
                                messageId: message.messageId
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
            messageId: message.messageId 
        });

    } catch (error) {
        console.error('QuickAI Google Error:', error);
        chrome.tabs.sendMessage(tabId, {
            type: 'streamError',
            error: error.message,
            messageId: message.messageId
        });
    }
}

// Handle screenshot capture
async function handleScreenshotCapture(tabId, sendResponse) {
    try {
        // Get page dimensions using scripting API
        const [dimensions] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                return {
                    scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
                    scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
                    clientWidth: document.documentElement.clientWidth,
                    clientHeight: document.documentElement.clientHeight,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    devicePixelRatio: window.devicePixelRatio || 1
                };
            }
        });

        const pageInfo = dimensions.result;
        
        // If page fits in viewport, just capture once
        if (pageInfo.scrollHeight <= pageInfo.viewportHeight && 
            pageInfo.scrollWidth <= pageInfo.viewportWidth) {
            const screenshot = await chrome.tabs.captureVisibleTab(null, {
                format: 'png',
                quality: 90
            });
            sendResponse({ screenshot: screenshot });
            return;
        }

        // Store original scroll position
        const [originalScroll] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => ({ x: window.scrollX, y: window.scrollY })
        });

        // Calculate scroll positions needed
        const scrollPositions = [];
        const viewportHeight = pageInfo.viewportHeight;
        const totalHeight = pageInfo.scrollHeight;
        
        for (let y = 0; y < totalHeight; y += viewportHeight) {
            scrollPositions.push({
                x: 0,
                y: y,
                height: Math.min(viewportHeight, totalHeight - y)
            });
        }

        // Capture screenshots with rate limiting
        const screenshots = [];
        for (let i = 0; i < scrollPositions.length; i++) {
            const pos = scrollPositions[i];
            
            // Scroll to position
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (x, y) => window.scrollTo(x, y),
                args: [pos.x, pos.y]
            });
            
            // Wait for scroll and rendering (and to avoid rate limiting)
            await new Promise(resolve => setTimeout(resolve, 600)); // 600ms ensures we stay under 2 calls/second
            
            // Capture visible area
            const screenshot = await chrome.tabs.captureVisibleTab(null, {
                format: 'png',
                quality: 90
            });
            
            screenshots.push({
                dataUrl: screenshot,
                x: pos.x,
                y: pos.y,
                height: pos.height
            });
        }

        // Restore original scroll position
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (x, y) => window.scrollTo(x, y),
            args: [originalScroll.result.x, originalScroll.result.y]
        });

        // Send screenshots to content script for stitching
        const [stitchedResult] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: stitchScreenshots,
            args: [screenshots, pageInfo]
        });

        if (stitchedResult.result.error) {
            throw new Error(stitchedResult.result.error);
        }

        sendResponse({ screenshot: stitchedResult.result.dataUrl || stitchedResult.result });
        
    } catch (error) {
        console.error('Screenshot capture error:', error);
        // Fallback to simple visible area capture
        try {
            const screenshot = await chrome.tabs.captureVisibleTab(null, {
                format: 'png',
                quality: 90
            });
            sendResponse({ 
                screenshot: screenshot,
                error: 'Could not capture full page. Showing visible area only.'
            });
        } catch (fallbackError) {
            sendResponse({ error: fallbackError.message });
        }
    }
}

// Function to be injected for stitching screenshots
async function stitchScreenshots(screenshots, pageInfo) {
    try {
        // Create canvas for full page
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = pageInfo.scrollWidth;
        canvas.height = pageInfo.scrollHeight;
        
        // Clear canvas with white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Load and draw all images
        for (const screenshot of screenshots) {
            await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    // Draw image at correct position
                    ctx.drawImage(img, screenshot.x, screenshot.y);
                    resolve();
                };
                img.onerror = () => reject(new Error('Failed to load screenshot image'));
                img.src = screenshot.dataUrl;
            });
        }
        
        // Compress image to ensure it's not too large
        let quality = 0.8;
        let fullPageDataUrl = canvas.toDataURL('image/jpeg', quality);
        
        // If image is too large (> 1MB), compress more
        while (fullPageDataUrl.length > 1024 * 1024 && quality > 0.1) {
            quality -= 0.1;
            fullPageDataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        
        console.log('Final image quality:', quality, 'Size:', fullPageDataUrl.length);
        return { dataUrl: fullPageDataUrl };
        
    } catch (error) {
        return { error: 'Failed to stitch screenshots: ' + error.message };
    }
}

// Handle AI query with screenshot
async function handleAIQueryWithScreenshot(message, tabId) {
    console.log('Handling AI query with screenshot, messageId:', message.messageId);
    try {
        // Get API key from storage
        const { apiKey } = await chrome.storage.sync.get('apiKey');
        
        if (!apiKey) {
            chrome.tabs.sendMessage(tabId, {
                type: 'streamError',
                error: 'API key not configured. Please set your OpenRouter API key in the extension options.',
                messageId: message.messageId
            });
            return;
        }
        
        // Add a note about vision support
        console.log('Note: Make sure the selected model supports vision/images. Not all models do.');

        // Notify start of streaming
        chrome.tabs.sendMessage(tabId, { 
            type: 'streamStart',
            messageId: message.messageId 
        });

        // Build messages array with screenshot
        const messages = [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: message.contextText ? 
                            `Context: The user selected this text on the page: "${message.contextText}"\n\n${message.prompt}` : 
                            message.prompt
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: message.screenshot
                        }
                    }
                ]
            }
        ];

        console.log('Sending request to OpenRouter with model:', message.model);
        console.log('Screenshot data length:', message.screenshot.length);
        console.log('Screenshot data prefix:', message.screenshot.substring(0, 50));
        console.log('Messages array:', JSON.stringify(messages[0].content.map(c => ({
            type: c.type,
            ...(c.type === 'text' ? { text: c.text.substring(0, 50) + '...' } : { image_url: { url: c.image_url.url.substring(0, 50) + '...' } })
        }))));
        
        // Check if model is known to support vision
        const visionModels = ['gpt-4-vision', 'gpt-4o', 'claude-3', 'gemini-pro-vision'];
        const modelSupportsVision = visionModels.some(vm => message.model.toLowerCase().includes(vm.toLowerCase()));
        if (!modelSupportsVision) {
            console.warn(`Model ${message.model} may not support vision. Consider using a vision-enabled model.`);
        }
        
        // Log the full request body size
        const requestBody = JSON.stringify({
            model: message.model,
            messages: messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 2000
        });
        console.log('Request body size:', requestBody.length);
        
        // Validate screenshot data
        if (!message.screenshot.startsWith('data:image/')) {
            console.error('Invalid screenshot data format');
            throw new Error('Screenshot data must be a valid data URL');
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
            body: requestBody
        });

        console.log('OpenRouter response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API error response:', errorText);
            
            // Check if it's a model capability issue
            if (errorText.includes('vision') || errorText.includes('image')) {
                throw new Error(`This model may not support images. Error: ${errorText}`);
            }
            
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        // Process streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        
                        if (content) {
                            chrome.tabs.sendMessage(tabId, {
                                type: 'streamChunk',
                                content: content,
                                rawContent: content,
                                messageId: message.messageId
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
            messageId: message.messageId 
        });

    } catch (error) {
        console.error('QuickAI Screenshot Error:', error);
        chrome.tabs.sendMessage(tabId, {
            type: 'streamError',
            error: error.message,
            messageId: message.messageId
        });
    }
}