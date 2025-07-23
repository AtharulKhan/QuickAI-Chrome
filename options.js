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
const templateSearchInput = document.getElementById('template-search');
const clearTemplateSearchBtn = document.getElementById('clear-template-search');

// Template form fields
const templateNameInput = document.getElementById('template-name');
const templateCategoryInput = document.getElementById('template-category');
const templateContentInput = document.getElementById('template-content');

// Data management DOM elements
const exportAllDataBtn = document.getElementById('export-all-data');
const importAllDataBtn = document.getElementById('import-all-data');
const importAllFileInput = document.getElementById('import-all-file');

// Template state
let editingTemplateId = null;
let templateSearchQuery = '';

// Hybrid Storage Helper Functions
// Store template metadata in sync storage and full content in local storage
const templateStorage = {
    // Get all templates using hybrid storage
    async getAll() {
        try {
            // Get metadata from sync storage
            const { templateMetadata = [] } = await chrome.storage.sync.get('templateMetadata');
            
            // If no metadata, check for legacy templates in sync storage
            const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
            if (promptTemplates.length > 0 && templateMetadata.length === 0) {
                // Migrate legacy templates
                await this.migrateLegacyTemplates(promptTemplates);
                return promptTemplates;
            }
            
            // Get full template data from local storage
            const templateIds = templateMetadata.map(t => `template_${t.id}`);
            if (templateIds.length === 0) return [];
            
            const localData = await chrome.storage.local.get(templateIds);
            
            // Combine metadata with full content
            return templateMetadata.map(meta => {
                const fullTemplate = localData[`template_${meta.id}`];
                return fullTemplate || { ...meta, content: '' }; // Fallback if local data missing
            });
        } catch (error) {
            console.error('Failed to get templates:', error);
            return [];
        }
    },
    
    // Save templates using hybrid storage
    async saveAll(templates) {
        try {
            // Prepare metadata for sync storage (lightweight)
            const metadata = templates.map(({ id, name, category }) => ({ id, name, category }));
            
            // Prepare full templates for local storage
            const localData = {};
            templates.forEach(template => {
                localData[`template_${template.id}`] = template;
            });
            
            // Save to both storages
            await Promise.all([
                chrome.storage.sync.set({ templateMetadata: metadata }),
                chrome.storage.local.set(localData)
            ]);
            
            // Clean up legacy sync storage if migration complete
            await chrome.storage.sync.remove('promptTemplates');
        } catch (error) {
            console.error('Failed to save templates:', error);
            throw error;
        }
    },
    
    // Add or update a single template
    async save(template) {
        const templates = await this.getAll();
        const index = templates.findIndex(t => t.id === template.id);
        
        if (index !== -1) {
            templates[index] = template;
        } else {
            templates.push(template);
        }
        
        await this.saveAll(templates);
    },
    
    // Delete a template
    async delete(templateId) {
        const templates = await this.getAll();
        const filtered = templates.filter(t => t.id !== templateId);
        
        // Remove from local storage
        await chrome.storage.local.remove(`template_${templateId}`);
        
        // Update metadata
        await this.saveAll(filtered);
    },
    
    // Migrate legacy templates from sync to hybrid storage
    async migrateLegacyTemplates(legacyTemplates) {
        console.log('Migrating legacy templates to hybrid storage...');
        try {
            await this.saveAll(legacyTemplates);
            console.log('Migration complete');
        } catch (error) {
            console.error('Migration failed:', error);
        }
    },
    
    // Check if template size is within limits
    validateSize(template) {
        const metadataSize = JSON.stringify({ id: template.id, name: template.name, category: template.category }).length;
        const fullSize = JSON.stringify(template).length;
        
        return {
            isValid: metadataSize < 1024, // Keep metadata well under sync limit
            metadataSize,
            fullSize
        };
    }
};

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
        const templates = await templateStorage.getAll();
        
        // If no templates exist, initialize with defaults
        if (templates.length === 0) {
            await templateStorage.saveAll(DEFAULT_TEMPLATES);
            displayTemplates(DEFAULT_TEMPLATES, templateSearchQuery);
        } else {
            displayTemplates(templates, templateSearchQuery);
        }
    } catch (error) {
        console.error('Failed to load templates:', error);
        templatesList.innerHTML = '<div class="error">Failed to load templates</div>';
    }
}

function displayTemplates(templates, searchQuery = '') {
    // Filter templates based on search query
    let filteredTemplates = templates;
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filteredTemplates = templates.filter(template => 
            template.name.toLowerCase().includes(query) ||
            (template.category && template.category.toLowerCase().includes(query)) ||
            template.content.toLowerCase().includes(query)
        );
    }

    if (filteredTemplates.length === 0) {
        if (searchQuery) {
            templatesList.innerHTML = '<div class="no-results">No templates found matching your search.</div>';
        } else {
            templatesList.innerHTML = '<div class="empty-state">No templates yet. Click "Add New Template" to create one.</div>';
        }
        return;
    }

    // Group templates by category
    const grouped = filteredTemplates.reduce((acc, template) => {
        const category = template.category || 'Uncategorized';
        if (!acc[category]) acc[category] = [];
        acc[category].push(template);
        return acc;
    }, {});

    let html = '';
    for (const [category, categoryTemplates] of Object.entries(grouped)) {
        html += `<div class="template-category">
            <h4>${highlightText(escapeHtml(category), searchQuery)}</h4>
            <div class="template-items">`;
        
        for (const template of categoryTemplates) {
            html += `
                <div class="template-item" data-id="${template.id}">
                    <div class="template-header">
                        <h5>${highlightText(escapeHtml(template.name), searchQuery)}</h5>
                        <div class="template-actions">
                            <button class="edit-template" title="Edit">✏️</button>
                            <button class="delete-template" title="Delete">🗑️</button>
                        </div>
                    </div>
                    <div class="template-content">${highlightText(escapeHtml(template.content), searchQuery)}</div>
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

// Highlight search matches
function highlightText(text, searchQuery) {
    if (!searchQuery) return text;
    
    const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

// Escape regex special characters
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function handleEditTemplate(e) {
    const templateId = e.target.closest('.template-item').dataset.id;
    const templates = await templateStorage.getAll();
    const template = templates.find(t => t.id === templateId);
    
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
            await templateStorage.delete(templateId);
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
        const template = {
            id: editingTemplateId || `custom-${Date.now()}`,
            name,
            category,
            content
        };
        
        // Validate template size
        const sizeCheck = templateStorage.validateSize(template);
        if (!sizeCheck.isValid) {
            showStatus(`Template metadata too large (${sizeCheck.metadataSize} bytes). Please use a shorter name or category.`, 'error');
            return;
        }
        
        await templateStorage.save(template);
        
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
        
        const currentTemplates = await templateStorage.getAll();
        
        // Add imported templates with new IDs to avoid conflicts
        const newTemplates = imported.map(t => ({
            id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: t.name,
            category: t.category || '',
            content: t.content
        }));
        
        // Validate sizes
        const oversizedTemplates = newTemplates.filter(t => !templateStorage.validateSize(t).isValid);
        if (oversizedTemplates.length > 0) {
            showStatus(`${oversizedTemplates.length} templates have metadata that's too large. Please shorten names/categories.`, 'error');
            return;
        }
        
        const combined = [...currentTemplates, ...newTemplates];
        await templateStorage.saveAll(combined);
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
        const templates = await templateStorage.getAll();
        
        // Clean up templates for export (remove IDs)
        const exportData = templates.map(({ name, category, content }) => ({
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

// Export all extension data
async function exportAllData() {
    try {
        // Get all data from storage
        const syncData = await chrome.storage.sync.get(null);
        const localData = await chrome.storage.local.get(null);
        
        // Get templates using hybrid storage
        const templates = await templateStorage.getAll();
        
        const exportData = {
            version: '1.1.0', // Updated version for new storage format
            exportDate: new Date().toISOString(),
            sync: {
                apiKey: syncData.apiKey || '',
                lastModel: syncData.lastModel || '',
                includePageContext: syncData.includePageContext || false,
                templateMetadata: syncData.templateMetadata || [],
                // Include legacy templates if they exist
                promptTemplates: syncData.promptTemplates || []
            },
            local: {
                history: localData.history || [],
                conversations: localData.conversations || [],
                // Include full templates
                templates: templates
            }
        };
        
        // Create and download JSON file
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `quickai-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        showStatus('All data exported successfully', 'success');
    } catch (error) {
        showStatus('Failed to export data', 'error');
        console.error('Export error:', error);
    }
}

// Import all extension data
async function importAllData(file) {
    try {
        const text = await file.text();
        const importData = JSON.parse(text);
        
        // Validate data structure
        if (!importData.version || !importData.sync || !importData.local) {
            throw new Error('Invalid backup file format');
        }
        
        // Validate sync data
        if (importData.sync.apiKey && !importData.sync.apiKey.startsWith('sk-or-')) {
            throw new Error('Invalid API key format in backup');
        }
        
        // Determine template count based on version
        let templateCount = 0;
        if (importData.version === '1.1.0' && importData.local.templates) {
            templateCount = importData.local.templates.length;
        } else if (importData.sync.promptTemplates) {
            templateCount = importData.sync.promptTemplates.length;
        }
        
        // Confirm with user
        const confirmMessage = `This will import:
- API Key: ${importData.sync.apiKey ? 'Yes' : 'No'}
- ${templateCount} prompt templates
- ${importData.local.history?.length || 0} conversation history entries
- Selected model: ${importData.sync.lastModel || 'None'}
- Page context setting: ${importData.sync.includePageContext ? 'Enabled' : 'Disabled'}

This will REPLACE all current data. Continue?`;
        
        if (!confirm(confirmMessage)) {
            return;
        }
        
        // Import sync data
        const syncDataToImport = {};
        if (importData.sync.apiKey) syncDataToImport.apiKey = importData.sync.apiKey;
        if (importData.sync.lastModel) syncDataToImport.lastModel = importData.sync.lastModel;
        if (importData.sync.includePageContext !== undefined) syncDataToImport.includePageContext = importData.sync.includePageContext;
        
        // Handle templates based on version
        if (importData.version === '1.1.0' && importData.local.templates) {
            // New format with hybrid storage
            await templateStorage.saveAll(importData.local.templates);
        } else if (importData.sync.promptTemplates) {
            // Legacy format - import and migrate
            await templateStorage.saveAll(importData.sync.promptTemplates);
        }
        
        // Don't import legacy promptTemplates to sync storage
        await chrome.storage.sync.set(syncDataToImport);
        
        // Import local data
        const localDataToImport = {};
        if (importData.local.history) localDataToImport.history = importData.local.history;
        if (importData.local.conversations) localDataToImport.conversations = importData.local.conversations;
        
        await chrome.storage.local.set(localDataToImport);
        
        showStatus('Data imported successfully! Refreshing...', 'success');
        
        // Reload the page to show new data
        setTimeout(() => {
            window.location.reload();
        }, 1500);
        
    } catch (error) {
        showStatus(`Import failed: ${error.message}`, 'error');
        console.error('Import error:', error);
    }
}

// Data management event handlers
exportAllDataBtn.addEventListener('click', exportAllData);

importAllDataBtn.addEventListener('click', () => {
    importAllFileInput.click();
});

importAllFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        await importAllData(file);
        // Reset input
        e.target.value = '';
    }
});

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

// Search functionality
const debouncedSearch = debounce(() => {
    templateSearchQuery = templateSearchInput.value.trim();
    clearTemplateSearchBtn.style.display = templateSearchQuery ? 'flex' : 'none';
    loadTemplates();
}, 300);

templateSearchInput.addEventListener('input', debouncedSearch);

clearTemplateSearchBtn.addEventListener('click', () => {
    templateSearchInput.value = '';
    templateSearchQuery = '';
    clearTemplateSearchBtn.style.display = 'none';
    loadTemplates();
});

// Handle Escape key to clear search
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement === templateSearchInput) {
        if (templateSearchInput.value) {
            templateSearchInput.value = '';
            templateSearchQuery = '';
            clearTemplateSearchBtn.style.display = 'none';
            loadTemplates();
        } else {
            templateSearchInput.blur();
        }
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadTemplates();
});