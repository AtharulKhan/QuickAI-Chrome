// DOM elements
const historyContainer = document.getElementById('history-container');
const emptyState = document.getElementById('empty-state');
const refreshButton = document.getElementById('refresh-history');

// Load and display history
async function loadHistory() {
    try {
        const { history = [] } = await chrome.storage.local.get('history');
        
        if (history.length === 0) {
            showEmptyState();
            return;
        }
        
        renderHistory(history);
    } catch (error) {
        console.error('Failed to load history:', error);
        historyContainer.innerHTML = '<p class="error">Failed to load history</p>';
    }
}

// Show empty state
function showEmptyState() {
    historyContainer.style.display = 'none';
    emptyState.style.display = 'flex';
}

// Render history items
function renderHistory(history) {
    historyContainer.style.display = 'block';
    emptyState.style.display = 'none';
    
    historyContainer.innerHTML = history.map((item, index) => {
        const date = new Date(item.timestamp);
        const formattedDate = formatDate(date);
        const formattedTime = formatTime(date);
        
        return `
            <div class="history-item" data-index="${index}">
                <div class="history-item-header" data-index="${index}">
                    <div class="history-item-meta">
                        <span class="history-timestamp">${formattedDate} at ${formattedTime}</span>
                        <span class="history-model">${getModelDisplayName(item.model)}</span>
                        <button class="history-delete-btn" data-index="${index}" title="Delete this conversation">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                    <p class="history-prompt">${escapeHtml(item.prompt)}</p>
                </div>
                <div class="history-item-body">
                    <div class="history-context">
                        <strong>Context:</strong> ${escapeHtml(item.context)}
                    </div>
                    <div class="history-response">
                        ${formatResponse(item.response)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Add click handlers for expansion
    document.querySelectorAll('.history-item-header').forEach(header => {
        header.addEventListener('click', toggleHistoryItem);
    });
    
    // Add click handlers for delete buttons
    document.querySelectorAll('.history-delete-btn').forEach(btn => {
        btn.addEventListener('click', deleteHistoryItem);
    });
}

// Toggle history item expansion
function toggleHistoryItem(e) {
    // Don't toggle if clicking on delete button
    if (e.target.closest('.history-delete-btn')) return;
    
    const index = e.currentTarget.dataset.index;
    const item = document.querySelector(`.history-item[data-index="${index}"]`);
    item.classList.toggle('expanded');
}

// Delete individual history item
async function deleteHistoryItem(e) {
    e.stopPropagation();
    
    const index = parseInt(e.currentTarget.dataset.index);
    
    if (confirm('Delete this conversation?')) {
        try {
            const { history = [] } = await chrome.storage.local.get('history');
            history.splice(index, 1);
            await chrome.storage.local.set({ history });
            loadHistory();
        } catch (error) {
            console.error('Failed to delete history item:', error);
            alert('Failed to delete conversation. Please try again.');
        }
    }
}

// Format date
function formatDate(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        });
    }
}

// Format time
function formatTime(date) {
    return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    });
}

// Get model display name
function getModelDisplayName(modelId) {
    const modelMap = {
        'google/gemini-flash-1.5': 'Gemini 1.5 Flash',
        'google/gemini-flash-1.5-8b': 'Gemini 1.5 Flash-8B',
        'google/gemini-pro-1.5': 'Gemini 1.5 Pro',
        'anthropic/claude-3.5-sonnet': 'Claude 3.5 Sonnet',
        'anthropic/claude-3-haiku': 'Claude 3 Haiku',
        'anthropic/claude-3-opus': 'Claude 3 Opus',
        'openai/gpt-4o': 'GPT-4o',
        'openai/gpt-4o-mini': 'GPT-4o Mini',
        'openai/o1-preview': 'o1 Preview',
        'openai/o1-mini': 'o1 Mini',
        'meta-llama/llama-3.1-8b-instruct': 'Llama 3.1 8B',
        'meta-llama/llama-3.1-70b-instruct': 'Llama 3.1 70B',
        'meta-llama/llama-3.1-405b-instruct': 'Llama 3.1 405B',
        'mistralai/mistral-large': 'Mistral Large',
        'mistralai/mixtral-8x7b-instruct': 'Mixtral 8x7B',
        'deepseek/deepseek-chat': 'DeepSeek Chat',
        'deepseek/deepseek-coder': 'DeepSeek Coder',
        'qwen/qwen-2.5-72b-instruct': 'Qwen 2.5 72B',
        'qwen/qwen-2.5-coder-32b-instruct': 'Qwen 2.5 Coder'
    };
    
    return modelMap[modelId] || modelId;
}

// Format response with basic markdown support
function formatResponse(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Refresh history
refreshButton.addEventListener('click', () => {
    refreshButton.disabled = true;
    loadHistory().then(() => {
        refreshButton.disabled = false;
    });
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.history) {
        loadHistory();
    }
});

// Initial load
loadHistory();