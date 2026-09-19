import type { TextBlock } from './document';

/** Merge adjacent words on the same line without bridging columns or table cells. */
export function translationRegions(blocks: TextBlock[]): TextBlock[] {
	const result: TextBlock[] = [];
	for (const block of blocks) {
		if (!block.text.trim() || block.width <= 0 || block.height <= 0)
			continue;
		const last = result.at(-1);
		const gap = last ? block.x - (last.x + last.width) : Infinity;
		if (last && Math.abs(last.y - block.y) < Math.min(last.height, block.height) * 0.3 && gap >= -1 && gap < block.height * 0.6) {
			last.text += ` ${block.text}`;
			last.width = block.x + block.width - last.x;
			last.height = Math.max(last.height, block.height);
		}
		else {
			result.push({ ...block });
		}
	}
	return result;
}

export function translatedLayer(container: HTMLElement, blocks: TextBlock[], scale: number): void {
	container.replaceChildren();
	for (const block of blocks) {
		const mask = document.createElement('div');
		mask.className = 'translation-mask';
		// PDF text coordinates are baseline-based; include descenders below the baseline.
		Object.assign(mask.style, { left: `${block.x * scale}px`, top: `${block.y * scale}px`, width: `${block.width * scale}px`, height: `${block.height * scale * 1.25}px` });
		const span = document.createElement('span');
		span.textContent = block.text;
		Object.assign(span.style, { left: '0', top: '0', color: '#111', fontSize: `${block.height * scale * 0.85}px` });
		mask.append(span);
		container.append(mask);
		const width = span.getBoundingClientRect().width;
		if (width > block.width * scale)
			span.style.transform = `scaleX(${block.width * scale / width})`;
	}
}
