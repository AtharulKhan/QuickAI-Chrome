// DOM elements
const apiKeyInput = document.getElementById('api-key');
const toggleVisibilityBtn = document.getElementById('toggle-visibility');
const saveSettingsBtn = document.getElementById('save-settings');
const clearHistoryBtn = document.getElementById('clear-history');
const statusMessage = document.getElementById('status-message');
const historyStats = document.getElementById('history-stats');

// Load saved settings
async function loadSettings() {
    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (apiKey) {
        apiKeyInput.value = apiKey;
    }
    
    updateHistoryStats();
}

// Update history statistics
async function updateHistoryStats() {
    const { history = [] } = await chrome.storage.local.get('history');
    const totalConversations = history.length;
    const totalCharacters = history.reduce((sum, conv) => sum + conv.response.length, 0);
    
    historyStats.innerHTML = `
        <div><strong>${totalConversations}</strong> conversations</div>
        <div><strong>${totalCharacters.toLocaleString()}</strong> total characters</div>
    `;
}

// Toggle password visibility
toggleVisibilityBtn.addEventListener('click', () => {
    const type = apiKeyInput.type === 'password' ? 'text' : 'password';
    apiKeyInput.type = type;
    
    // Update icon
    const icon = type === 'password' 
        ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
        : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
    
    toggleVisibilityBtn.querySelector('svg').innerHTML = icon;
});

// Save settings
saveSettingsBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
        showStatus('Please enter an API key', 'error');
        return;
    }
    
    if (!apiKey.startsWith('sk-or-')) {
        showStatus('Invalid API key format. OpenRouter keys start with "sk-or-"', 'error');
        return;
    }
    
    try {
        await chrome.storage.sync.set({ apiKey });
        showStatus('Settings saved successfully!', 'success');
    } catch (error) {
        showStatus('Failed to save settings', 'error');
        console.error(error);
    }
});

// Clear history
clearHistoryBtn.addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to clear all conversation history? This action cannot be undone.');
    
    if (confirmed) {
        try {
            await chrome.storage.local.set({ history: [] });
            showStatus('History cleared successfully', 'success');
            updateHistoryStats();
        } catch (error) {
            showStatus('Failed to clear history', 'error');
            console.error(error);
        }
    }
});

// Show status message
function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message show ${type}`;
    
    setTimeout(() => {
        statusMessage.classList.remove('show');
    }, 3000);
}

// Handle Enter key in API key input
apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        saveSettingsBtn.click();
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', loadSettings);