[简体中文](./README.md) | [English](#) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Datasheet AI Assistant

A JLCEDA Pro Edition extension — select a schematic component, automatically fetch its datasheet, and ask AI questions about it.


## Demo

**Select a component and click the menu to open AI chat**

![Select Component Menu](./images/image.png)

**AI Chat Panel — auto-loads datasheet, streaming Q&A**

![AI Chat Panel](./images/image1.png)

## Features

- **One-Click Launch**: Select a component in the schematic and open the AI chat panel via the top menu
- **Auto-Fetch Datasheet**: Automatically reads the component's Datasheet URL and downloads the PDF
- **Smart PDF Parsing**:
  - Text-based PDFs: direct text extraction (pdf.js)
  - Scanned PDFs: automatic OCR fallback (Tesseract.js)
- **On-Demand Search**: Intelligently matches relevant paragraphs based on user keywords; auto-expands to parse more pages when no match is found
- **Streaming AI Chat**: Powered by OpenAI-compatible API with real-time SSE streaming
- **Context Management**: Automatically carries conversation history (up to 6 recent messages)
- **Markdown Rendering**: Rich text display with code blocks, tables, lists, and more
- **Adaptive Theme**: Follows the system light/dark color scheme
- **Custom API Configuration**: Supports configuring API endpoint, key, and model name

## Quick Start

### Installation

1. Download the extension package (`.eext` file)
2. Open JLCEDA Pro Edition
3. Navigate to **Advanced → Extension Manager → Upload/Install Extension**
4. Select the downloaded `.eext` file to install

### Usage

1. Select a component in the schematic
2. Click the top menu **Datasheet AI Assistant → Open AI Chat**
3. On first use, click the ⚙ icon in the top-right corner of the panel to configure AI API settings:
   - **API Endpoint**: e.g., `https://api.openai.com/v1`
   - **API Key**: Your AI service key
   - **Model Name**: e.g., `gpt-4o-mini`
4. Once the datasheet is loaded, type your question in the input box

> [!TIP]
> Example questions: List the key electrical parameters, What are the pin definitions, Package information, Operating voltage range, etc.

## Permissions

| Permission | Purpose |
|------------|---------|
| External Interaction | Download PDF datasheets, call AI API |

If PDF download fails, please ensure the extension's **External Interaction permission** is enabled in the Extension Manager.

## Tech Stack

- [pdf.js](https://github.com/mozilla/pdf.js) — PDF document parsing
- [Tesseract.js](https://github.com/naptha/tesseract.js) — OCR text recognition
- OpenAI-compatible API — AI chat (SSE streaming)

## Project Structure

```
datasheet-ai-assistant/
├── src/
│   └── index.ts            # Extension main entry
├── iframe/
│   ├── chat.html           # AI chat panel (HTML + inline CSS/JS)
│   ├── chat.js             # Chat panel JS logic (source)
│   └── chat.css            # Chat panel styles (source)
├── images/
│   └── logo.png            # Extension icon
├── extension.json          # Extension configuration
├── package.json            # Project dependencies and build scripts
└── build/
    └── dist/               # Compiled .eext output
```

## Build from Source

```shell
# Install dependencies
npm install

# Compile and package
npm run build
```

The generated extension package will be in `./build/dist/`.

## Development Documentation

JLCEDA Pro Edition Extension API Documentation: [https://prodocs.easyeda.com/en/api/guide/](https://prodocs.easyeda.com/en/api/guide/)

## Changelog

### v1.0.0

- Initial release
- Auto-fetch datasheet for selected components
- PDF text extraction and scanned document OCR support
- OpenAI-compatible API streaming chat
- On-demand search strategy with intelligent content matching

## License

[Apache License 2.0](./LICENSE)
