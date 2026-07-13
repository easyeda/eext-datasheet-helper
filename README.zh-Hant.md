[简体中文](./README.md) | [English](./README.en.md) | [繁體中文](#) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# 數據手冊AI問答助手

嘉立創EDA專業版擴展 — 選中原理圖器件，自動獲取數據手冊，通過AI對話解答技術問題。


## 功能演示

**選中器件，點擊菜單打開AI問答**

![選中器件菜單](./images/image.png)

**AI 對話窗口 — 自動加載數據手冊，流式問答**

![AI對話窗口](./images/image1.png)

## 功能特性

- **一鍵啟動**：在原理圖中選中器件，通過菜單快速打開AI問答窗口
- **自動獲取數據手冊**：自動讀取器件關聯的 Datasheet URL 並下載 PDF
- **智能PDF解析**：
  - 文本型 PDF 直接提取文字內容（pdf.js）
  - 掃描型 PDF 自動切換 OCR 識別（Tesseract.js）
- **按需搜索策略**：根據用戶提問關鍵詞，在數據手冊中智能匹配相關段落，未命中時自動擴展解析更多頁面
- **AI流式對話**：基於 OpenAI 兼容 API，支持 SSE 流式實時輸出
- **上下文管理**：對話歷史自動攜帶，最多保留最近 6 條交互
- **Markdown 渲染**：支持代碼塊、表格、列表等格式的富文本展示
- **明暗主題自適應**：跟隨系統亮色/暗色主題
- **自定義 API 配置**：支持配置 API 端點、密鑰、模型名稱

## 快速開始

### 安裝

1. 下載擴展包（`.eext` 文件）
2. 打開嘉立創EDA專業版
3. 進入 **高級 → 擴展管理器 → 上傳/安裝擴展**
4. 選擇下載的 `.eext` 文件完成安裝

### 使用步驟

1. 在原理圖中選中一個器件
2. 點擊頂部菜單 **數據手冊AI助手 → 打開AI問答**
3. 首次使用時，點擊窗口右上角的 ⚙ 圖標配置 AI API 信息：
   - **API 端點**：如 `https://api.openai.com/v1`
   - **API Key**：你的 AI 服務密鑰
   - **模型名稱**：如 `gpt-4o-mini`
4. 數據手冊加載完成後，直接在輸入框中提問

> [!TIP]
> 提問示例：列出器件的關鍵電氣參數、引腳定義是什麼、封裝信息、工作電壓範圍等。

## 權限要求

| 權限 | 用途 |
|------|------|
| 外部交互權限 | 下載 PDF 數據手冊、調用 AI API |

如遇 PDF 下載失敗，請在擴展管理器中確認已啟用本擴展的**外部交互權限**。

## 技術棧

- [pdf.js](https://github.com/mozilla/pdf.js) — PDF 文檔解析
- [Tesseract.js](https://github.com/naptha/tesseract.js) — OCR 圖像文字識別
- OpenAI 兼容 API — AI 對話（SSE 流式）

## 項目結構

```
datasheet-ai-assistant/
├── src/
│   └── index.ts            # 擴展主入口
├── iframe/
│   ├── chat.html           # AI 對話窗口（HTML + 內聯 CSS/JS）
│   ├── chat.js             # 對話窗口 JS 邏輯（源文件）
│   └── chat.css            # 對話窗口樣式（源文件）
├── images/
│   └── logo.png            # 擴展圖標
├── extension.json          # 擴展配置文件
├── package.json            # 項目依賴與構建腳本
└── build/
    └── dist/               # 編譯輸出的 .eext 擴展包
```

## 從源碼構建

```shell
# 安裝依賴
npm install

# 編譯並打包
npm run build
```

生成的擴展包位於 `./build/dist/` 目錄下。

## 開發文檔

嘉立創EDA專業版擴展 API 開發文檔：[https://prodocs.easyeda.com/cn/api/guide/](https://prodocs.easyeda.com/cn/api/guide/)

## 更新日誌

### v1.0.0

- 初始版本
- 支持選中器件自動獲取數據手冊
- 支持 PDF 文本解析與掃描型文檔 OCR
- 支持 OpenAI 兼容 API 流式對話
- 按需搜索策略，智能匹配相關內容

## 開源許可

[Apache License 2.0](./LICENSE)
