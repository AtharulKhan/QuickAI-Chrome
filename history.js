// DOM elements
const historyContainer = document.getElementById('history-container');
const emptyState = document.getElementById('empty-state');
const refreshButton = document.getElementById('refresh-history');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const modelFilter = document.getElementById('model-filter');
const dateFilter = document.getElementById('date-filter');
const exportButton = document.getElementById('export-history');
const clearHistoryButton = document.getElementById('clear-history');
const resultCount = document.getElementById('result-count');
const storageUsage = document.getElementById('storage-usage');
const bulkActions = document.getElementById('bulk-actions');
const selectedCount = document.getElementById('selected-count');
const selectAllBtn = document.getElementById('select-all');
const deleteSelectedBtn = document.getElementById('delete-selected');

// State
let allHistory = [];
let filteredHistory = [];
let searchTerm = '';
let selectedModel = '';
let selectedDateRange = '';
let selectionMode = false;
let selectedItems = new Set();

// Load and display history
async function loadHistory() {
    try {
        const { history = [] } = await chrome.storage.local.get('history');
        
        // Migrate old history items to include new fields
        allHistory = history.map(item => ({
            ...item,
            favorite: item.favorite || false,
            tags: item.tags || [],
            title: item.title || ''
        }));
        
        if (allHistory.length === 0) {
            showEmptyState();
            updateStats(0);
            return;
        }
        
        // Populate model filter
        populateModelFilter();
        
        // Apply filters and render
        applyFilters();
        
        // Update storage usage
        updateStorageUsage();
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

// Apply filters
function applyFilters() {
    filteredHistory = allHistory.filter(item => {
        // Search filter
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch = 
                item.prompt.toLowerCase().includes(searchLower) ||
                item.context.toLowerCase().includes(searchLower) ||
                item.response.toLowerCase().includes(searchLower) ||
                (item.title && item.title.toLowerCase().includes(searchLower)) ||
                (item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchLower)));
            
            if (!matchesSearch) return false;
        }
        
        // Model filter
        if (selectedModel && item.model !== selectedModel) {
            return false;
        }
        
        // Date filter
        if (selectedDateRange) {
            const itemDate = new Date(item.timestamp);
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            switch (selectedDateRange) {
                case 'today':
                    if (itemDate < startOfToday) return false;
                    break;
                case 'yesterday':
                    const startOfYesterday = new Date(startOfToday);
                    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
                    if (itemDate < startOfYesterday || itemDate >= startOfToday) return false;
                    break;
                case 'week':
                    const weekAgo = new Date(now);
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    if (itemDate < weekAgo) return false;
                    break;
                case 'month':
                    const monthAgo = new Date(now);
                    monthAgo.setDate(monthAgo.getDate() - 30);
                    if (itemDate < monthAgo) return false;
                    break;
            }
        }
        
        return true;
    });
    
    // Sort with favorites first
    filteredHistory.sort((a, b) => {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        return 0;
    });
    
    renderHistory(filteredHistory);
    updateStats(filteredHistory.length);
}

// Render history items
function renderHistory(history) {
    historyContainer.style.display = 'block';
    emptyState.style.display = 'none';
    
    if (history.length === 0) {
        historyContainer.innerHTML = '<p class="no-results">No conversations match your search criteria</p>';
        return;
    }
    
    historyContainer.innerHTML = history.map((item, index) => {
        const date = new Date(item.timestamp);
        const formattedDate = formatDate(date);
        const formattedTime = formatTime(date);
        
        const actualIndex = allHistory.indexOf(item);
        return `
            <div class="history-item ${item.favorite ? 'favorited' : ''} ${selectedItems.has(actualIndex) ? 'selected' : ''}" data-index="${actualIndex}">
                ${selectionMode ? `<input type="checkbox" class="history-checkbox" data-index="${actualIndex}" ${selectedItems.has(actualIndex) ? 'checked' : ''}>` : ''}
                <div class="history-item-header" data-index="${actualIndex}">
                    <div class="history-item-meta">
                        <span class="history-timestamp">${formattedDate} at ${formattedTime}</span>
                        <span class="history-model">${getModelDisplayName(item.model)}</span>
                        <button class="history-favorite-btn ${item.favorite ? 'active' : ''}" data-index="${actualIndex}" title="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="${item.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                            </svg>
                        </button>
                        <button class="history-delete-btn" data-index="${actualIndex}" title="Delete this conversation">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                    <h3 class="history-title" data-index="${actualIndex}" contenteditable="false">${item.title || highlightText(escapeHtml(item.prompt), searchTerm)}</h3>
                    ${item.tags.length > 0 || true ? `
                        <div class="history-tags">
                            ${item.tags.map(tag => `
                                <span class="tag" data-tag="${escapeHtml(tag)}">
                                    ${escapeHtml(tag)}
                                    <span class="tag-remove" data-index="${actualIndex}" data-tag="${escapeHtml(tag)}">×</span>
                                </span>
                            `).join('')}
                            <button class="add-tag" data-index="${actualIndex}">+ Add tag</button>
                        </div>
                    ` : ''}
                </div>
                <div class="history-item-body">
                    <div class="history-context">
                        <strong>Context:</strong> ${highlightText(escapeHtml(item.context), searchTerm)}
                    </div>
                    <div class="history-response">
                        ${highlightText(formatResponse(item.response), searchTerm)}
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
    
    // Add click handlers for favorite buttons
    document.querySelectorAll('.history-favorite-btn').forEach(btn => {
        btn.addEventListener('click', toggleFavorite);
    });
    
    // Add handlers for title editing
    document.querySelectorAll('.history-title').forEach(title => {
        title.addEventListener('dblclick', enableTitleEdit);
        title.addEventListener('blur', saveTitleEdit);
        title.addEventListener('keydown', handleTitleKeydown);
    });
    
    // Add handlers for tags
    document.querySelectorAll('.add-tag').forEach(btn => {
        btn.addEventListener('click', addTag);
    });
    
    document.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', removeTag);
    });
    
    document.querySelectorAll('.tag').forEach(tag => {
        tag.addEventListener('click', filterByTag);
    });
    
    // Add handlers for checkboxes
    if (selectionMode) {
        document.querySelectorAll('.history-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', handleCheckboxChange);
        });
    }
}

// Toggle history item expansion
function toggleHistoryItem(e) {
    // Don't toggle if clicking on buttons or editable elements
    if (e.target.closest('.history-delete-btn') || 
        e.target.closest('.history-favorite-btn') ||
        e.target.closest('.add-tag') ||
        e.target.closest('.tag') ||
        e.target.closest('.history-checkbox') ||
        e.target.contentEditable === 'true') return;
    
    const index = e.currentTarget.dataset.index;
    const item = document.querySelector(`.history-item[data-index="${index}"]`);
    
    // In selection mode, clicking toggles selection
    if (selectionMode) {
        const checkbox = item.querySelector('.history-checkbox');
        checkbox.checked = !checkbox.checked;
        handleCheckboxChange({ target: checkbox });
    } else {
        item.classList.toggle('expanded');
    }
}

// Delete individual history item
async function deleteHistoryItem(e) {
    e.stopPropagation();
    
    const index = parseInt(e.currentTarget.dataset.index);
    
    if (confirm('Delete this conversation?')) {
        try {
            allHistory.splice(index, 1);
            await chrome.storage.local.set({ history: allHistory });
            applyFilters();
            updateStorageUsage();
        } catch (error) {
            console.error('Failed to delete history item:', error);
            alert('Failed to delete conversation. Please try again.');
        }
    }
}

// Toggle favorite status
async function toggleFavorite(e) {
    e.stopPropagation();
    
    const index = parseInt(e.currentTarget.dataset.index);
    allHistory[index].favorite = !allHistory[index].favorite;
    
    try {
        await chrome.storage.local.set({ history: allHistory });
        applyFilters();
    } catch (error) {
        console.error('Failed to update favorite status:', error);
    }
}

// Enable title editing
function enableTitleEdit(e) {
    const titleElement = e.target;
    const index = parseInt(titleElement.dataset.index);
    const item = allHistory[index];
    
    titleElement.contentEditable = 'true';
    titleElement.textContent = item.title || item.prompt;
    titleElement.focus();
    
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(titleElement);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}

// Save title edit
async function saveTitleEdit(e) {
    const titleElement = e.target;
    const index = parseInt(titleElement.dataset.index);
    const newTitle = titleElement.textContent.trim();
    
    titleElement.contentEditable = 'false';
    
    if (newTitle !== allHistory[index].title) {
        allHistory[index].title = newTitle;
        
        try {
            await chrome.storage.local.set({ history: allHistory });
        } catch (error) {
            console.error('Failed to save title:', error);
            titleElement.textContent = allHistory[index].title || allHistory[index].prompt;
        }
    }
}

// Handle title editing keyboard events
function handleTitleKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
    } else if (e.key === 'Escape') {
        const index = parseInt(e.target.dataset.index);
        e.target.textContent = allHistory[index].title || allHistory[index].prompt;
        e.target.blur();
    }
}

// Add tag
async function addTag(e) {
    e.stopPropagation();
    
    const index = parseInt(e.currentTarget.dataset.index);
    const tagName = prompt('Enter tag name:');
    
    if (tagName && tagName.trim()) {
        const tag = tagName.trim().toLowerCase();
        if (!allHistory[index].tags.includes(tag)) {
            allHistory[index].tags.push(tag);
            
            try {
                await chrome.storage.local.set({ history: allHistory });
                applyFilters();
            } catch (error) {
                console.error('Failed to add tag:', error);
            }
        }
    }
}

// Remove tag
async function removeTag(e) {
    e.stopPropagation();
    
    const index = parseInt(e.currentTarget.dataset.index);
    const tag = e.currentTarget.dataset.tag;
    
    allHistory[index].tags = allHistory[index].tags.filter(t => t !== tag);
    
    try {
        await chrome.storage.local.set({ history: allHistory });
        applyFilters();
    } catch (error) {
        console.error('Failed to remove tag:', error);
    }
}

// Filter by tag
function filterByTag(e) {
    e.stopPropagation();
    
    const tag = e.currentTarget.dataset.tag;
    searchInput.value = `#${tag}`;
    searchTerm = searchInput.value;
    clearSearchBtn.style.display = searchTerm ? 'flex' : 'none';
    applyFilters();
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

// Highlight search matches
function highlightText(text, searchTerm) {
    if (!searchTerm) return text;
    
    const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

// Escape regex special characters
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Populate model filter
function populateModelFilter() {
    const models = [...new Set(allHistory.map(item => item.model))];
    
    modelFilter.innerHTML = '<option value="">All Models</option>';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = getModelDisplayName(model);
        modelFilter.appendChild(option);
    });
}

// Update statistics
function updateStats(count) {
    const total = allHistory.length;
    if (searchTerm || selectedModel || selectedDateRange) {
        resultCount.textContent = `Showing ${count} of ${total} conversations`;
    } else {
        resultCount.textContent = `${total} conversation${total !== 1 ? 's' : ''}`;
    }
}

// Update storage usage
async function updateStorageUsage() {
    try {
        const bytesUsed = await chrome.storage.local.getBytesInUse('history');
        const mbUsed = (bytesUsed / (1024 * 1024)).toFixed(2);
        storageUsage.textContent = `Storage: ${mbUsed} MB used`;
    } catch (error) {
        console.error('Failed to get storage usage:', error);
    }
}

// Export history
function exportHistory() {
    const dialog = document.createElement('div');
    dialog.className = 'export-dialog';
    dialog.innerHTML = `
        <h3>Export History</h3>
        <div class="export-options">
            <label class="export-option">
                <input type="radio" name="export-format" value="json" checked>
                <span>JSON (Complete data)</span>
            </label>
            <label class="export-option">
                <input type="radio" name="export-format" value="markdown">
                <span>Markdown (Human-readable)</span>
            </label>
        </div>
        <div class="dialog-buttons">
            <button class="btn-secondary" onclick="this.closest('.export-dialog').remove(); document.querySelector('.dialog-overlay').remove();">Cancel</button>
            <button class="btn-primary" onclick="performExport()">Export</button>
        </div>
    `;
    
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.onclick = () => {
        dialog.remove();
        overlay.remove();
    };
    
    document.body.appendChild(overlay);
    document.body.appendChild(dialog);
}

// Perform export
window.performExport = function() {
    const format = document.querySelector('input[name="export-format"]:checked').value;
    const dataToExport = filteredHistory.length > 0 ? filteredHistory : allHistory;
    
    let content, filename;
    
    if (format === 'json') {
        content = JSON.stringify(dataToExport, null, 2);
        filename = `quickai-history-${new Date().toISOString().split('T')[0]}.json`;
    } else {
        content = '# QuickAI Conversation History\n\n';
        dataToExport.forEach(item => {
            const date = new Date(item.timestamp);
            content += `## ${item.title || item.prompt}\n`;
            content += `**Date:** ${date.toLocaleDateString()} ${date.toLocaleTimeString()}\n`;
            content += `**Model:** ${getModelDisplayName(item.model)}\n`;
            if (item.tags.length > 0) {
                content += `**Tags:** ${item.tags.join(', ')}\n`;
            }
            content += `\n**Context:** ${item.context}\n\n`;
            content += `**Prompt:** ${item.prompt}\n\n`;
            content += `**Response:**\n${item.response}\n\n---\n\n`;
        });
        filename = `quickai-history-${new Date().toISOString().split('T')[0]}.md`;
    }
    
    // Create and download file
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Close dialog
    document.querySelector('.export-dialog').remove();
    document.querySelector('.dialog-overlay').remove();
};

// Clear all history
async function clearAllHistory() {
    if (confirm('Are you sure you want to delete ALL conversation history? This cannot be undone.')) {
        if (confirm('This will permanently delete all conversations. Are you absolutely sure?')) {
            try {
                await chrome.storage.local.set({ history: [] });
                allHistory = [];
                filteredHistory = [];
                showEmptyState();
                updateStats(0);
                updateStorageUsage();
            } catch (error) {
                console.error('Failed to clear history:', error);
                alert('Failed to clear history. Please try again.');
            }
        }
    }
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Event listeners
refreshButton.addEventListener('click', () => {
    refreshButton.disabled = true;
    loadHistory().then(() => {
        refreshButton.disabled = false;
    });
});

exportButton.addEventListener('click', exportHistory);
clearHistoryButton.addEventListener('click', clearAllHistory);

// Search functionality
const debouncedSearch = debounce(() => {
    searchTerm = searchInput.value.trim();
    clearSearchBtn.style.display = searchTerm ? 'flex' : 'none';
    applyFilters();
}, 300);

searchInput.addEventListener('input', debouncedSearch);

clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchTerm = '';
    clearSearchBtn.style.display = 'none';
    applyFilters();
});

// Filter listeners
modelFilter.addEventListener('change', (e) => {
    selectedModel = e.target.value;
    applyFilters();
});

dateFilter.addEventListener('change', (e) => {
    selectedDateRange = e.target.value;
    applyFilters();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + F to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
    }
    
    // Escape to clear search
    if (e.key === 'Escape' && document.activeElement === searchInput) {
        if (searchInput.value) {
            searchInput.value = '';
            searchTerm = '';
            clearSearchBtn.style.display = 'none';
            applyFilters();
        } else {
            searchInput.blur();
        }
    }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.history) {
        loadHistory();
    }
});

// Enable selection mode
function enableSelectionMode() {
    selectionMode = true;
    document.body.classList.add('selection-mode');
    bulkActions.style.display = 'flex';
    selectedItems.clear();
    updateSelectedCount();
    applyFilters();
}

// Disable selection mode
function disableSelectionMode() {
    selectionMode = false;
    document.body.classList.remove('selection-mode');
    bulkActions.style.display = 'none';
    selectedItems.clear();
    applyFilters();
}

// Handle checkbox change
function handleCheckboxChange(e) {
    const index = parseInt(e.target.dataset.index);
    
    if (e.target.checked) {
        selectedItems.add(index);
    } else {
        selectedItems.delete(index);
    }
    
    // Update UI
    const item = document.querySelector(`.history-item[data-index="${index}"]`);
    item.classList.toggle('selected', e.target.checked);
    
    updateSelectedCount();
}

// Update selected count
function updateSelectedCount() {
    selectedCount.textContent = `${selectedItems.size} selected`;
    deleteSelectedBtn.disabled = selectedItems.size === 0;
    
    // Update select all button text
    const visibleItems = filteredHistory.map(item => allHistory.indexOf(item));
    const allSelected = visibleItems.length > 0 && visibleItems.every(index => selectedItems.has(index));
    selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
}

// Select/Deselect all visible items
function toggleSelectAll() {
    const visibleItems = filteredHistory.map(item => allHistory.indexOf(item));
    const allSelected = visibleItems.length > 0 && visibleItems.every(index => selectedItems.has(index));
    
    if (allSelected) {
        // Deselect all
        visibleItems.forEach(index => selectedItems.delete(index));
    } else {
        // Select all
        visibleItems.forEach(index => selectedItems.add(index));
    }
    
    applyFilters();
}

// Delete selected items
async function deleteSelectedItems() {
    if (selectedItems.size === 0) return;
    
    if (confirm(`Delete ${selectedItems.size} selected conversation${selectedItems.size > 1 ? 's' : ''}?`)) {
        try {
            // Sort indices in descending order to delete from end to start
            const indices = Array.from(selectedItems).sort((a, b) => b - a);
            
            indices.forEach(index => {
                allHistory.splice(index, 1);
            });
            
            await chrome.storage.local.set({ history: allHistory });
            
            // Exit selection mode
            disableSelectionMode();
            
            // Reload
            applyFilters();
            updateStorageUsage();
        } catch (error) {
            console.error('Failed to delete selected items:', error);
            alert('Failed to delete selected conversations. Please try again.');
        }
    }
}

// Add bulk selection keyboard shortcut
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + A to select all when in selection mode
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && selectionMode) {
        e.preventDefault();
        toggleSelectAll();
    }
    
    // Ctrl/Cmd + Shift + D to enable selection mode
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault();
        if (selectionMode) {
            disableSelectionMode();
        } else {
            enableSelectionMode();
        }
    }
});

// Bulk action event listeners
selectAllBtn.addEventListener('click', toggleSelectAll);
deleteSelectedBtn.addEventListener('click', deleteSelectedItems);

// Long press to enable selection mode
let longPressTimer;
historyContainer.addEventListener('mousedown', (e) => {
    if (e.target.closest('.history-item-header') && !selectionMode) {
        longPressTimer = setTimeout(() => {
            enableSelectionMode();
            // Select the item that was long-pressed
            const index = parseInt(e.target.closest('.history-item').dataset.index);
            selectedItems.add(index);
            applyFilters();
        }, 500);
    }
});

historyContainer.addEventListener('mouseup', () => {
    clearTimeout(longPressTimer);
});

historyContainer.addEventListener('mouseleave', () => {
    clearTimeout(longPressTimer);
});

// Initial load
loadHistory();