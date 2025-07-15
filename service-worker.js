// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'queryAI') {
        handleAIQuery(message, sender.tab.id);
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
        chrome.tabs.sendMessage(tabId, { type: 'streamStart' });

        // Build system message with context
        const systemMessage = message.fullContext ? 
            `You are a helpful AI assistant. The user has selected the following text from a webpage: "${message.context}". 

Here is additional context from the surrounding paragraphs:
${message.fullContext.before ? `Before the selection:\n${message.fullContext.before}\n` : ''}
${message.fullContext.after ? `After the selection:\n${message.fullContext.after}` : ''}

Please provide helpful, relevant, and concise responses based on this context. Focus primarily on the selected text, but use the surrounding context to better understand the topic.` :
            `You are a helpful AI assistant. The user has selected the following text from a webpage as context: "${message.context}". Please provide helpful, relevant, and concise responses based on this context.`;
        

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
                                rawContent: content // Send raw content for copying
                            });
                        }
                    } catch (e) {
                        console.error('Error parsing stream data:', e);
                    }
                }
            }
        }

        // Save to history
        await saveToHistory({
            context: message.context,
            prompt: message.prompt,
            response: fullResponse,
            model: message.model,
            timestamp: new Date().toISOString()
        });

        // Notify completion
        chrome.tabs.sendMessage(tabId, { type: 'streamEnd' });

    } catch (error) {
        console.error('QuickAI Error:', error);
        chrome.tabs.sendMessage(tabId, {
            type: 'streamError',
            error: error.message
        });
    }
}

// Save conversation to history
async function saveToHistory(conversation) {
    const { history = [] } = await chrome.storage.sync.get('history');
    
    // Add new conversation to beginning
    history.unshift(conversation);
    
    // Keep only last 100 conversations
    if (history.length > 100) {
        history.splice(100);
    }
    
    await chrome.storage.sync.set({ history });
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