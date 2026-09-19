import type { PageContent } from './document';

declare const pdfjsLib: any;
declare const __PDF_WORKER_SOURCE__: string;

function ensureWorker(): void {
	if (pdfjsLib.GlobalWorkerOptions.workerPort)
		return;
	// EDA rewrites page script URLs, but native Worker cannot use those virtual paths.
	const url = URL.createObjectURL(new Blob([__PDF_WORKER_SOURCE__], { type: 'text/javascript' }));
	try {
		pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(url, { name: 'datasheet-pdf' });
	}
	finally {
		URL.revokeObjectURL(url);
	}
}

export async function openPdf(blob: Blob): Promise<any> {
	ensureWorker();
	return pdfjsLib.getDocument({
		data: new Uint8Array(await blob.arrayBuffer()),
		isEvalSupported: false,
		cMapUrl: '/iframe/assets/cmaps/',
		cMapPacked: true,
		standardFontDataUrl: '/iframe/assets/standard_fonts/',
	}).promise;
}

export async function extractPage(pdf: any, number: number): Promise<PageContent> {
	const page = await pdf.getPage(number);
	const viewport = page.getViewport({ scale: 1 });
	const content = await page.getTextContent();
	const blocks = content.items
		.filter((item: any) => typeof item.str === 'string' && item.str.trim())
		.map((item: any) => {
			const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
			const height = Math.hypot(tx[2], tx[3]);
			return { text: item.str, x: tx[4], y: tx[5] - height, width: Math.abs(item.width), height: height || 10 };
		});
	let lastY = -1;
	let text = '';
	for (const block of blocks) {
		text += `${lastY < 0 ? '' : Math.abs(lastY - block.y) > block.height * 0.5 ? '\n' : ' '}${block.text}`;
		lastY = block.y;
	}
	return { number, width: viewport.width, height: viewport.height, blocks, text, source: 'pdf' };
}

export async function pageCanvas(pdf: any, number: number, scale = 1.5): Promise<HTMLCanvasElement> {
	const page = await pdf.getPage(number);
	const base = page.getViewport({ scale });
	// Bound raster memory for oversized engineering drawings.
	const bounded = Math.min(scale, (scale * 2200) / Math.max(base.width, base.height));
	const viewport = page.getViewport({ scale: bounded });
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
	return canvas;
}

export function textLayer(container: HTMLElement, page: PageContent, scale: number): void {
	container.replaceChildren();
	// VLM block geometry is not used as an exact text-selection layer.
	for (const block of page.blocks) {
		const span = document.createElement('span');
		span.textContent = `${block.text} `;
		span.style.left = `${block.x * scale}px`;
		span.style.top = `${block.y * scale}px`;
		span.style.fontSize = `${block.height * scale}px`;
		span.style.height = `${block.height * scale}px`;
		container.append(span);
		const measured = span.getBoundingClientRect().width;
		if (measured)
			span.style.transform = `scaleX(${(block.width * scale) / measured})`;
	}
}
