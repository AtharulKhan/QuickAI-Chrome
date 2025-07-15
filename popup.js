// Handle settings button click
document.getElementById('open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});

// Handle history button click
document.getElementById('open-history').addEventListener('click', async () => {
    // Get the current window
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Open the side panel
    await chrome.sidePanel.open({ windowId: tab.windowId });
    
    window.close();
});