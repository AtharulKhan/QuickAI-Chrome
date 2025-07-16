// DOM elements
const apiKeyInput = document.getElementById('api-key');
const toggleVisibilityBtn = document.getElementById('toggle-visibility');
const saveSettingsBtn = document.getElementById('save-settings');
const clearHistoryBtn = document.getElementById('clear-history');
const statusMessage = document.getElementById('status-message');
const historyStats = document.getElementById('history-stats');

// Template DOM elements
const addTemplateBtn = document.getElementById('add-template');
const importTemplatesBtn = document.getElementById('import-templates');
const exportTemplatesBtn = document.getElementById('export-templates');
const templateForm = document.getElementById('template-form');
const saveTemplateBtn = document.getElementById('save-template');
const cancelTemplateBtn = document.getElementById('cancel-template');
const templatesList = document.getElementById('templates-list');
const importFileInput = document.getElementById('import-file');

// Template form fields
const templateNameInput = document.getElementById('template-name');
const templateCategoryInput = document.getElementById('template-category');
const templateContentInput = document.getElementById('template-content');

// Template state
let editingTemplateId = null;

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

// Default templates
const DEFAULT_TEMPLATES = [
    {
        id: 'default-1',
        name: 'Summarize',
        content: 'Please summarize the following text concisely: {{text}}',
        category: 'General'
    },
    {
        id: 'default-2',
        name: 'Email Reply',
        content: 'Write a professional email reply to: {{content}}',
        category: 'Email'
    },
    {
        id: 'default-3',
        name: 'Meeting Notes',
        content: 'Create structured meeting notes from the following discussion: {{discussion}}',
        category: 'Meeting'
    },
    {
        id: 'default-4',
        name: 'Code Explanation',
        content: 'Explain the following code in simple terms: {{code}}',
        category: 'Technical'
    },
    {
        id: 'default-5',
        name: 'Research Summary',
        content: 'Provide a comprehensive research summary about: {{topic}}',
        category: 'Research'
    }
];

// Template Management Functions
async function loadTemplates() {
    try {
        const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
        
        // If no templates exist, initialize with defaults
        if (promptTemplates.length === 0) {
            await chrome.storage.sync.set({ promptTemplates: DEFAULT_TEMPLATES });
            displayTemplates(DEFAULT_TEMPLATES);
        } else {
            displayTemplates(promptTemplates);
        }
    } catch (error) {
        console.error('Failed to load templates:', error);
        templatesList.innerHTML = '<div class="error">Failed to load templates</div>';
    }
}

function displayTemplates(templates) {
    if (templates.length === 0) {
        templatesList.innerHTML = '<div class="empty-state">No templates yet. Click "Add New Template" to create one.</div>';
        return;
    }

    // Group templates by category
    const grouped = templates.reduce((acc, template) => {
        const category = template.category || 'Uncategorized';
        if (!acc[category]) acc[category] = [];
        acc[category].push(template);
        return acc;
    }, {});

    let html = '';
    for (const [category, categoryTemplates] of Object.entries(grouped)) {
        html += `<div class="template-category">
            <h4>${category}</h4>
            <div class="template-items">`;
        
        for (const template of categoryTemplates) {
            html += `
                <div class="template-item" data-id="${template.id}">
                    <div class="template-header">
                        <h5>${escapeHtml(template.name)}</h5>
                        <div class="template-actions">
                            <button class="edit-template" title="Edit">✏️</button>
                            <button class="delete-template" title="Delete">🗑️</button>
                        </div>
                    </div>
                    <div class="template-content">${escapeHtml(template.content)}</div>
                </div>`;
        }
        
        html += '</div></div>';
    }

    templatesList.innerHTML = html;

    // Add event listeners
    document.querySelectorAll('.edit-template').forEach(btn => {
        btn.addEventListener('click', handleEditTemplate);
    });
    document.querySelectorAll('.delete-template').forEach(btn => {
        btn.addEventListener('click', handleDeleteTemplate);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function handleEditTemplate(e) {
    const templateId = e.target.closest('.template-item').dataset.id;
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const template = promptTemplates.find(t => t.id === templateId);
    
    if (template) {
        editingTemplateId = templateId;
        templateNameInput.value = template.name;
        templateCategoryInput.value = template.category || '';
        templateContentInput.value = template.content;
        templateForm.style.display = 'block';
        templateNameInput.focus();
    }
}

async function handleDeleteTemplate(e) {
    const templateId = e.target.closest('.template-item').dataset.id;
    const confirmed = confirm('Are you sure you want to delete this template?');
    
    if (confirmed) {
        try {
            const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
            const filtered = promptTemplates.filter(t => t.id !== templateId);
            await chrome.storage.sync.set({ promptTemplates: filtered });
            loadTemplates();
            showStatus('Template deleted successfully', 'success');
        } catch (error) {
            showStatus('Failed to delete template', 'error');
        }
    }
}

// Template form event handlers
addTemplateBtn.addEventListener('click', () => {
    editingTemplateId = null;
    templateForm.style.display = 'block';
    templateNameInput.value = '';
    templateCategoryInput.value = '';
    templateContentInput.value = '';
    templateNameInput.focus();
});

cancelTemplateBtn.addEventListener('click', () => {
    templateForm.style.display = 'none';
    editingTemplateId = null;
});

saveTemplateBtn.addEventListener('click', async () => {
    const name = templateNameInput.value.trim();
    const category = templateCategoryInput.value.trim();
    const content = templateContentInput.value.trim();
    
    if (!name || !content) {
        showStatus('Please provide both name and content for the template', 'error');
        return;
    }
    
    try {
        const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
        
        if (editingTemplateId) {
            // Update existing template
            const index = promptTemplates.findIndex(t => t.id === editingTemplateId);
            if (index !== -1) {
                promptTemplates[index] = { id: editingTemplateId, name, category, content };
            }
        } else {
            // Add new template
            const newTemplate = {
                id: `custom-${Date.now()}`,
                name,
                category,
                content
            };
            promptTemplates.push(newTemplate);
        }
        
        await chrome.storage.sync.set({ promptTemplates });
        templateForm.style.display = 'none';
        editingTemplateId = null;
        loadTemplates();
        showStatus('Template saved successfully', 'success');
    } catch (error) {
        showStatus('Failed to save template', 'error');
        console.error(error);
    }
});

// Import/Export functionality
importTemplatesBtn.addEventListener('click', () => {
    importFileInput.click();
});

importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
        const text = await file.text();
        const imported = JSON.parse(text);
        
        if (!Array.isArray(imported) || !imported.every(t => t.name && t.content)) {
            throw new Error('Invalid template format');
        }
        
        const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
        
        // Add imported templates with new IDs to avoid conflicts
        const newTemplates = imported.map(t => ({
            id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: t.name,
            category: t.category || '',
            content: t.content
        }));
        
        const combined = [...promptTemplates, ...newTemplates];
        await chrome.storage.sync.set({ promptTemplates: combined });
        loadTemplates();
        showStatus(`Imported ${newTemplates.length} templates successfully`, 'success');
    } catch (error) {
        showStatus('Failed to import templates. Please check the file format.', 'error');
        console.error(error);
    }
    
    // Reset input
    e.target.value = '';
});

exportTemplatesBtn.addEventListener('click', async () => {
    try {
        const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
        
        // Clean up templates for export (remove IDs)
        const exportData = promptTemplates.map(({ name, category, content }) => ({
            name,
            category,
            content
        }));
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `quickai-templates-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        showStatus('Templates exported successfully', 'success');
    } catch (error) {
        showStatus('Failed to export templates', 'error');
        console.error(error);
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadTemplates();
});