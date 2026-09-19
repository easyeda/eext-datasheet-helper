import {
	AutoModelForVision2Seq,
	AutoProcessor,
	env,
	pipeline,
	RawImage,
	TextStreamer,
} from '@huggingface/transformers';
import { hasRepeatedVlmBlocks } from './document';
import { createImportedModelCache } from './model-store';
import { setupOrtRuntime } from './ort-runtime';

let model: any;
let processor: any;
let task = '';
let currentId = 0;
function send(type: string, data: Record<string, unknown> = {}): void {
	postMessage({ id: currentId, type, ...data });
}

globalThis.onmessage = async (event) => {
	const { id, type, payload } = event.data;
	currentId = id;
	try {
		if (type === 'init') {
			setupOrtRuntime();
			task = payload.role;
			env.allowLocalModels = !!payload.imported;
			env.allowRemoteModels = !payload.imported;
			env.useBrowserCache = !payload.imported;
			env.useCustomCache = !!payload.imported;
			if (payload.imported) {
				const cache = createImportedModelCache(payload.imported);
				await cache.prepare();
				env.customCache = cache as unknown as Cache;
				env.fetch = async input => (await cache.match(input)) || new Response(null, { status: 404 });
			}
			else {
				env.remoteHost = payload.mirror.replace(/\/+$/, '');
				env.remotePathTemplate = '{model}/resolve/{revision}/';
			}
			const name = payload.imported ? `imported/${payload.imported.id}` : payload.spec.name;
			const options: any = {
				// ORT's extended QDQ transpose pass fails on the OPUS-MT shared embedding graph.
				// Basic optimization retains constant folding without that invalid rewrite.
				session_options: task === 'en-zh' || task === 'zh-en' ? { graphOptimizationLevel: 'basic' } : {},
				device: payload.backend,
				dtype: payload.spec.dtype,
				local_files_only: !!payload.imported,
				progress_callback: (p: any) =>
					send('progress', {
						text: `${payload.backend === 'webgpu' ? 'GPU' : 'CPU'} · ${p.file || ''} ${p.progress ? `${Math.round(p.progress)}%` : p.status || ''}`,
					}),
			};
			if (task === 'vlm') {
				processor = await AutoProcessor.from_pretrained(name, options);
				model = await AutoModelForVision2Seq.from_pretrained(name, options);
			}
			else {
				const taskName
					= task === 'chat' ? 'text-generation' : task === 'embedding' ? 'feature-extraction' : 'translation';
				model = await pipeline(taskName, name, options);
			}
			send('done', { result: payload.backend });
		}
		else if (type === 'embed') {
			const result = await model(payload.texts, { pooling: 'mean', normalize: true, truncation: true });
			send('done', { result: result.tolist() });
		}
		else if (type === 'translate') {
			const result = await model(payload.text, { max_new_tokens: 512, do_sample: false });
			send('done', { result: result[0].translation_text });
		}
		else if (type === 'vlm') {
			const raw = new RawImage(new Uint8ClampedArray(payload.pixels), payload.width, payload.height, 4);
			const text = processor.apply_chat_template(
				[
					{
						role: 'user',
						content: [{ type: 'image' }, { type: 'text', text: 'Convert this page to docling.' }],
					},
				],
				{ add_generation_prompt: true },
			);
			const inputs = await processor(text, [raw], { do_image_splitting: true });
			const contextLimit
				= Number(model.config.text_config?.max_position_embeddings || model.config.max_position_embeddings)
					|| 8192;
			const outputLimit = Math.min(8192, contextLimit - Number(inputs.input_ids.dims.at(-1)) - 16);
			if (outputLimit < 256)
				throw new Error('页面图像占满模型上下文，请使用普通 OCR 或更大上下文的兼容模型');
			let generated = 0;
			let partial = '';
			const streamer = new TextStreamer(processor.tokenizer, {
				skip_prompt: true,
				skip_special_tokens: false,
				token_callback_function: () => {
					generated++;
					send('progress', { text: `VLM 已生成 ${generated} tokens，可随时取消` });
				},
				callback_function: (text: string) => {
					partial += text;
					if (hasRepeatedVlmBlocks(partial)) {
						throw new Error(
							'VLM 出现连续重复识别，已停止本页并保留原内容。请使用普通 OCR 或其他兼容模型。',
						);
					}
					send('token', { text });
				},
			});
			send('progress', { text: 'VLM 正在分析页面图像…' });
			const ids = await model.generate({ ...inputs, max_new_tokens: outputLimit, do_sample: false, streamer });
			if (generated >= outputLimit)
				throw new Error('VLM 达到输出上限，本页结果不完整，已保留原内容。请使用普通 OCR 或其他兼容模型。');
			const result = processor.batch_decode(ids.slice(null, [inputs.input_ids.dims.at(-1), null]), {
				skip_special_tokens: false,
			})[0];
			send('done', { result });
		}
		else if (type === 'chat') {
			const messages = structuredClone(payload.messages);
			const count = () =>
				model.tokenizer.encode(
					model.tokenizer.apply_chat_template(messages, {
						tokenize: false,
						add_generation_prompt: true,
						enable_thinking: false,
					}),
					{ add_special_tokens: false },
				).length;
			const limit = Math.min(8192, Number(model.model.config.max_position_embeddings) || 8192) - 1024;
			while (count() > limit && messages.length > 2) messages.splice(1, 1);
			while (!payload.fullContext && count() > limit && messages[0].content.length > 600)
				messages[0].content = messages[0].content.slice(0, Math.floor(messages[0].content.length * 0.8));
			if (count() > limit)
				throw new Error('全文或问题超过当前模型上下文容量，请启用向量化或选择支持更长上下文的模型/API；未截取全文。');
			const streamer = new TextStreamer(model.tokenizer, {
				skip_prompt: true,
				skip_special_tokens: true,
				callback_function: (text: string) => send('token', { text }),
			});
			await model(messages, {
				max_new_tokens: 1024,
				do_sample: false,
				streamer,
				tokenizer_encode_kwargs: { enable_thinking: false },
			});
			send('done');
		}
		else {
			throw new Error(`Unknown inference operation: ${type}`);
		}
	}
	catch (error) {
		send('error', { text: (error as Error).message, name: (error as Error).name });
	}
};
