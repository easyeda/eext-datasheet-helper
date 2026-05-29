[简体中文](#) | [English](./README.en.md) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# 数据手册助手 (Datasheet Helper)

嘉立创EDA & EasyEDA 专业版数据手册提取与分析扩展

<a href="https://github.com/easyeda/eext-datasheet-helper" style="vertical-align: inherit;" target="_blank"><img src="https://img.shields.io/github/stars/easyeda/eext-datasheet-helper" alt="GitHub Repo Stars" class="not-medium-zoom-image" style="display: inline; vertical-align: inherit;" /></a>&nbsp;<a href="https://github.com/easyeda/eext-datasheet-helper/issues" style="vertical-align: inherit;" target="_blank"><img src="https://img.shields.io/github/issues/easyeda/eext-datasheet-helper" alt="GitHub Issues" class="not-medium-zoom-image" style="display: inline; vertical-align: inherit;" /></a>&nbsp;<a href="https://choosealicense.com/licenses/apache-2.0/" style="vertical-align: inherit;" target="_blank"><img src="https://img.shields.io/github/license/easyeda/eext-datasheet-helper" alt="GitHub License" class="not-medium-zoom-image" style="display: inline; vertical-align: inherit;" /></a>

## 功能简介

数据手册助手是一款基于 AI 的 PDF 数据手册分析工具，作为嘉立创EDA专业版的扩展使用。支持将器件数据手册（Datasheet）等 PDF 文档内容提取为结构化文本，并通过 AI 对话方式帮助工程师快速获取技术参数和关键信息。

### 主要功能

- **PDF 内容提取**：基于 PDF.js 的版面分析，支持表格识别、多栏布局解析和标题检测
- **AI 智能问答**：接入 OpenAI 兼容 API，基于文档内容进行精准问答
- **数据手册优化**：针对器件 Datasheet 场景优化，保留参数表格结构
- **多场景可用**：在原理图编辑器、PCB 编辑器和主页中均可使用

## 快速开始

### 安装扩展

1. 从 [Releases](https://github.com/easyeda/eext-datasheet-helper/releases) 下载最新 `.zip` 扩展包
2. 在嘉立创EDA专业版中，进入 **扩展管理** → **安装本地扩展**，选择下载的文件

### 配置 API

1. 在扩展菜单中点击 **设置**
2. 填写以下信息：
   - **API URL**：OpenAI 兼容接口地址（如 `https://api.openai.com/v1/chat/completions`）
   - **API Key**：你的 API 密钥
   - **Model**：使用的模型名称（如 `gpt-4o`）

### 使用方法

1. 在扩展菜单中点击 **打开数据手册助手**
2. 拖拽或点击上传 PDF 文件
3. 在对话框中输入问题，AI 将基于 PDF 内容进行回答

## 本地开发

1. 克隆项目仓库

    ```shell
    git clone --depth=1 https://github.com/easyeda/eext-datasheet-helper.git
    ```

2. 安装依赖

    ```shell
    npm install
    ```

3. 编译扩展包

    ```shell
    npm run build
    ```

4. 安装 `./build/dist/` 目录下生成的扩展包到嘉立创EDA专业版

## 项目结构

```
eext-datasheet-helper/
├── src/            # 扩展入口（TypeScript）
├── iframe/         # 前端界面（PDF提取 + AI对话）
│   ├── index.html  # 主页面
│   ├── app.js      # 核心逻辑（PDF解析、API调用）
│   └── style.css   # 样式
├── server/         # 服务端逻辑
├── config/         # 构建配置
├── locales/        # 国际化资源
├── images/         # 图标资源
└── extension.json  # 扩展配置
```

## 开源许可

<a href="https://choosealicense.com/licenses/apache-2.0/" style="vertical-align: inherit;" target="_blank"><img src="https://img.shields.io/github/license/easyeda/eext-datasheet-helper" alt="GitHub License" class="not-medium-zoom-image" style="display: inline; vertical-align: inherit;" /></a>

本项目使用 [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/) 开源许可协议。
