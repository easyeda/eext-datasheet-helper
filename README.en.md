[简体中文](./README.md) | [English](#) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Datasheet Helper

JLCEDA & EasyEDA Pro Extension for PDF Datasheet Extraction and Analysis

<a href="https://github.com/easyeda/eext-datasheet-helper" style="vertical-align: inherit;" target="_blank"><img src="https://img.shields.io/github/stars/easyeda/eext-datasheet-helper" alt="GitHub Repo Stars" class="not-medium-zoom-image" style="display: inline; vertical-align: inherit;" /></a>&nbsp;<a href="https://github.com/easyeda/eext-datasheet-helper/issues" style="vertical-align: inherit;" target="_blank"><img src="https://img.shields.io/github/issues/easyeda/eext-datasheet-helper" alt="GitHub Issues" class="not-medium-zoom-image" style="display: inline; vertical-align: inherit;" /></a>&nbsp;<a href="https://choosealicense.com/licenses/apache-2.0/" style="vertical-align: inherit;" target="_blank"><img src="https://img.shields.io/github/license/easyeda/eext-datasheet-helper" alt="GitHub License" class="not-medium-zoom-image" style="display: inline; vertical-align: inherit;" /></a>

## Overview

Datasheet Helper is an AI-powered PDF datasheet analysis tool for JLCEDA & EasyEDA Pro Edition. It extracts content from component datasheets and other PDF documents into structured text, enabling engineers to quickly retrieve technical specifications and key information through AI-powered conversations.

### Key Features

- **PDF Content Extraction**: Layout analysis powered by PDF.js, with support for table recognition, multi-column layout parsing, and heading detection
- **AI-Powered Q&A**: Integrates with OpenAI-compatible APIs for precise document-based question answering
- **Datasheet Optimized**: Tailored for component datasheets, preserving parameter table structures
- **Multi-Context**: Available in Schematic Editor, PCB Editor, and Home page

## Quick Start

### Install the Extension

1. Download the latest `.zip` package from [Releases](https://github.com/easyeda/eext-datasheet-helper/releases)
2. In EasyEDA Pro Edition, go to **Extension Manager** → **Install Local Extension** and select the downloaded file

### Configure API

1. Click **Settings** in the extension menu
2. Fill in the following:
   - **API URL**: OpenAI-compatible endpoint (e.g. `https://api.openai.com/v1/chat/completions`)
   - **API Key**: Your API key
   - **Model**: Model name to use (e.g. `gpt-4o`)

### Usage

1. Click **Open Datasheet Helper** in the extension menu
2. Drag and drop or click to upload a PDF file
3. Type your question in the chat box — the AI will answer based on the PDF content

## Local Development

1. Clone the repository

    ```shell
    git clone --depth=1 https://github.com/easyeda/eext-datasheet-helper.git
    ```

2. Install dependencies

    ```shell
    npm install
    ```

3. Build the extension

    ```shell
    npm run build
    ```

4. Install the generated extension from `./build/dist/` into EasyEDA Pro Edition

## Project Structure

```
eext-datasheet-helper/
├── src/            # Extension entry (TypeScript)
├── iframe/         # Frontend UI (PDF extraction + AI chat)
│   ├── index.html  # Main page
│   ├── app.js      # Core logic (PDF parsing, API calls)
│   └── style.css   # Styles
├── server/         # Server-side logic
├── config/         # Build configuration
├── locales/        # Internationalization resources
├── images/         # Icon assets
└── extension.json  # Extension manifest
```

## License

<a href="https://choosealicense.com/licenses/apache-2.0/" style="vertical-align: inherit;" target="_blank"><img src="https://img.shields.io/github/license/easyeda/eext-datasheet-helper" alt="GitHub License" class="not-medium-zoom-image" style="display: inline; vertical-align: inherit;" /></a>

This project is licensed under the [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/).
