import type { Inference } from './inference';
import type { Settings } from './settings';
import { docTagsText } from './document';

/** Bound output size for dense datasheet tables; overlap keeps boundary lines readable. */
export async function recognizeVlmCanvas(
	canvas: HTMLCanvasElement,
	inference: Inference,
	config: Settings,
	signal: AbortSignal,
	progress: (text: string) => void,
): Promise<string> {
	const count = Math.max(1, Math.ceil(canvas.height / (canvas.width * 0.6)));
	const parts: string[] = [];
	for (let index = 0; index < count; index++) {
		signal.throwIfAborted();
		const top = Math.max(
			0,
			Math.floor((index * canvas.height) / count) - 24,
		);
		const bottom = Math.min(
			canvas.height,
			Math.ceil(((index + 1) * canvas.height) / count) + 24,
		);
		const tile = document.createElement('canvas');
		tile.width = canvas.width;
		tile.height = bottom - top;
		const ctx = tile.getContext('2d')!;
		ctx.drawImage(
			canvas,
			0,
			top,
			canvas.width,
			bottom - top,
			0,
			0,
			tile.width,
			tile.height,
		);
		const pixels = ctx.getImageData(0, 0, tile.width, tile.height);
		let ink = false;
		for (let pixel = 0; pixel < pixels.data.length; pixel += 4 * 17) {
			if (pixels.data[pixel] < 200 && pixels.data[pixel + 3] > 0) {
				ink = true;
				break;
			}
		}
		if (!ink)
			continue;
		progress(`VLM 页面分区 ${index + 1}/${count}`);
		const raw = await inference.run(
			'vlm',
			'vlm',
			{
				pixels: pixels.data.buffer,
				width: tile.width,
				height: tile.height,
			},
			config,
		);
		signal.throwIfAborted();
		const text = docTagsText(raw);
		if (text)
			parts.push(text);
	}
	// Only remove exact overlap at a region boundary, never deduplicate table rows globally.
	let result = '';
	for (const part of parts) {
		const lines = part.split('\n');
		const previous = result.split('\n');
		let overlap = 0;
		for (
			let size = 1;
			size <= Math.min(8, lines.length, previous.length);
			size++
		) {
			if (
				previous.slice(-size).join('\n')
				=== lines.slice(0, size).join('\n')
			) {
				overlap = size;
			}
		}
		result += `${result ? '\n\n' : ''}${lines.slice(overlap).join('\n')}`;
	}
	if (!result.trim())
		throw new Error('VLM 未提取到文字，请使用普通 OCR 或其他兼容模型');
	return result;
}
