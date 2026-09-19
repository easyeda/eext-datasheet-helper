# Datasheet AI Q&A Assistant

**Starting with v1.9.1, the extension has been refactored to support a local AI mode featuring a vision-language model (VLM), an embedding model, and a large language model (LLM). Local mode requires a device with sufficient performance.**

A datasheet AI Q&A assistant powered by a VLM for visual document understanding.
Import a PDF datasheet, and the assistant will automatically retrieve relevant content and use an AI model to generate answers to your questions.

- Default general-purpose model: [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B)
- Default VLM for visual document understanding: [granite-docling-258M](https://huggingface.co/ibm-granite/granite-docling-258M)
- Default embedding model: [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)
- Default Chinese-English translation model: [Helsinki-NLP opus-mt](https://huggingface.co/Helsinki-NLP)
- Default model mirror: [🤗 Hugging Face](https://huggingface.co/)

## Feature Demos

### Local AI Mode: WebGPU Inference with VLM + Embedding + LLM

| Inference Results | Inference Configuration |
| --- | --- |
| ![Inference results](images/gif1.gif) | ![Inference configuration](images/image4.png) |

### Online AI Mode: Q&A via Online APIs

| Inference Results | Inference Configuration |
| --- | --- |
| ![Inference results](images/gif3.gif) | ![Inference configuration](images/image2.png) |

### PDF Reader: Local Translation

| Original | Translation |
| --- | --- |
| ![Original text](images/7.png) | ![Translated text](images/6.png) |

## Quick Start

### Installation

1. Download the extension package (the `.eext` file).
2. Open EasyEDA Pro.
3. Go to **Advanced → Extension Manager → Upload/Install Extension**.
4. Select the downloaded `.eext` file to complete the installation.

## Required Permissions

| Permission | Purpose |
| --- | --- |
| External Interaction | Download PDF datasheets and call AI APIs |

If a PDF download fails, make sure that **External Interaction** permission is enabled for this extension in the Extension Manager.

## Acknowledgements

- [Transformers.js](https://github.com/huggingface/transformers.js) — in-browser model inference
- [pdf.js](https://github.com/mozilla/pdf.js) — PDF document parsing
- [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) — LLM
- [granite-docling-258M](https://huggingface.co/ibm-granite/granite-docling-258M) — VLM for visual document understanding
- [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) — multilingual embedding model
- [Helsinki-NLP opus-mt](https://huggingface.co/Helsinki-NLP) — local translation model for the PDF reader
- [🤗 Hugging Face](https://huggingface.co/) — open-source AI community
- [Open Neural Network Exchange](https://github.com/onnx) — ONNX community
