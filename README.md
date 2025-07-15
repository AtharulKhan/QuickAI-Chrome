# QuickAI - Instant AI Assistance for Chrome

QuickAI is a Chrome extension that brings the power of AI directly to any webpage. Simply hold Alt and highlight text to get instant AI assistance without breaking your workflow.

## ✨ Features

- **🚀 Instant Access**: Hold `Alt` + select text to activate AI assistance
- **💬 Contextual AI**: The AI understands the text you've selected
- **🤖 Multiple Models**: Access various AI models through OpenRouter
- **⚡ Real-time Streaming**: See responses as they're generated
- **📚 Conversation History**: Track all your AI interactions in a side panel
- **🎨 Modern UI**: Clean, minimal design with smooth animations
- **🔒 Secure**: Your API key is stored securely in Chrome's encrypted storage

## 📸 Screenshots

### Floating AI Interface
The AI appears right where you need it, without switching tabs or windows.

### Conversation History
Access all your past conversations from the Chrome side panel.

## 🚀 Installation

### For Users

1. Download the latest release from the [Releases page](https://github.com/QuickAI/releases)
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the QuickAI folder

### For Developers

```bash
# Clone the repository
git clone https://github.com/QuickAI/quickai-chrome-extension.git

# Navigate to the project directory
cd quickai-chrome-extension

# No build step required - load directly in Chrome
```

## ⚙️ Configuration

1. Click the QuickAI icon in your Chrome toolbar
2. Select "Settings"
3. Enter your [OpenRouter API key](https://openrouter.ai/keys)
4. Save your settings

## 📖 Usage

### Basic Usage

1. **Activate**: Hold the `Alt` key and select any text on a webpage
2. **Ask**: Type your question in the floating interface
3. **Submit**: Press Enter or click Submit to get your response

### Available Models

QuickAI supports a wide range of AI models through OpenRouter:

- **Google**: Gemini 1.5 Flash, Gemini 1.5 Pro
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Haiku, Claude 3 Opus
- **OpenAI**: GPT-4o, GPT-4o Mini, o1 Preview
- **Meta**: Llama 3.1 (8B, 70B, 405B)
- **Mistral**: Mistral Large, Mixtral 8x7B
- **DeepSeek**: DeepSeek Chat, DeepSeek Coder
- **Qwen**: Qwen 2.5 72B, Qwen 2.5 Coder

### Keyboard Shortcuts

- `Alt` + Mouse Selection: Activate QuickAI
- `Ctrl` + `Enter`: Submit your question (when input is focused)
- `Escape`: Close the floating interface

## 🛠️ Project Structure

```
quickai/
├── manifest.json          # Extension configuration
├── content-script.js      # Handles page interactions
├── content.css           # Styles for floating UI
├── service-worker.js     # Background script for API calls
├── models.js             # Available AI models
├── options.html/js/css   # Settings page
├── history.html/js/css   # Side panel history
├── popup.html/js/css     # Extension popup
└── icons/                # Extension icons
```

## 🔧 Development

### Modifying Available Models

Edit `models.js` to add or remove AI models:

```javascript
const models = [
    { id: 'model-id', name: 'Display Name' },
    // Add more models here
];
```

### Debugging

1. Open Chrome DevTools on any page
2. Check the Console for content script logs
3. Visit `chrome://extensions/` and click "Service Worker" for background logs

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [OpenRouter](https://openrouter.ai) for providing access to multiple AI models
- The Chrome Extensions team for the excellent documentation
- All contributors who help improve QuickAI

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/QuickAI/issues)
- **Discussions**: [GitHub Discussions](https://github.com/QuickAI/discussions)

---

Made with ❤️ by developers, for developers.