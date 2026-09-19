export interface TextBlock {
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface PageContent {
	number: number;
	width: number;
	height: number;
	text: string;
	blocks: TextBlock[];
	source: 'pdf' | 'ocr' | 'vlm';
	error?: string;
}
export interface Chunk {
	id: string;
	page: number;
	text: string;
}
export interface VectorEntry {
	id: string;
	vector: number[];
}
export interface DocumentRecord {
	cacheVersion?: number;
	vlm?: { pages: Record<number, PageContent>; index?: DocumentRecord['index']; modelSignature?: string };
	id: string;
	name: string;
	blob: Blob;
	pageCount: number;
	pages: Record<number, PageContent>;
	index?: { fingerprint: string; entries: VectorEntry[]; complete: boolean };
	translations: Record<string, { fingerprint: string; pages: Record<number, string>; layouts?: Record<number, { fingerprint: string; blocks: TextBlock[] }> }>;
}

export function migrateDocument(record: DocumentRecord): DocumentRecord {
	if (record.cacheVersion === 2)
		return record;
	record.vlm ||= { pages: {} };
	for (const [key, page] of Object.entries(record.pages)) {
		if (page.source === 'vlm') {
			record.vlm.pages[Number(key)] = page;
			delete record.pages[Number(key)];
		}
	}
	record.index = undefined;
	record.vlm.index = undefined;
	record.cacheVersion = 2;
	return record;
}

export function parsePageRange(value: string, current: number, total: number): number[] {
	if (value.trim() === 'current')
		return [current];
	if (value.trim() === 'all')
		return Array.from({ length: total }, (_, i) => i + 1);
	const pages = new Set<number>();
	for (const part of value.split(',')) {
		const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
		if (!match)
			throw new Error('页码格式：1-5,8；或选择当前页/全文');
		const start = Number(match[1]);
		const end = Number(match[2] || match[1]);
		if (start < 1 || end > total || end < start)
			throw new Error(`页码必须在 1–${total} 内`);
		for (let n = start; n <= end; n++) pages.add(n);
	}
	return [...pages].sort((a, b) => a - b);
}

export function chunksFor(pages: Record<number, PageContent>): Chunk[] {
	const chunks: Chunk[] = [];
	for (const page of Object.values(pages).sort((a, b) => a.number - b.number)) {
		const lines = page.text.split('\n').filter(line => line.trim());
		let text = '';
		let count = 0;
		const emit = () => {
			if (text.trim())
				chunks.push({ id: `${page.number}:${count++}`, page: page.number, text: text.trim() });
			text = '';
		};
		for (const line of lines) {
			// Bound even single-line pages; preserve complete short table rows.
			for (let i = 0; i < line.length; i += 600) {
				const part = line.slice(i, i + 600);
				if (text.length + part.length > 650)
					emit();
				text += `${part}\n`;
			}
		}
		emit();
	}
	return chunks;
}

function terms(text: string): string[] {
	const words = text.toLowerCase().match(/[a-z0-9][a-z0-9_.+-]*|[\u3400-\u9FFF]+/g) || [];
	return [
		...new Set(
			words.flatMap(word =>
				/^[\u3400-\u9FFF]+$/.test(word) && word.length > 1
					? Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))
					: [word],
			),
		),
	];
}

export function cosine(a: number[], b: number[]): number {
	if (a.length !== b.length || !a.length || ![...a, ...b].every(Number.isFinite))
		throw new Error('向量维度或数值无效，请重建索引');
	let dot = 0;
	let aa = 0;
	let bb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		aa += a[i] ** 2;
		bb += b[i] ** 2;
	}
	return dot / (Math.sqrt(aa * bb) || 1);
}

export function retrieve(chunks: Chunk[], question: string, entries?: VectorEntry[], query?: number[]): Chunk[] {
	const tokens = terms(question);
	const keyword = chunks
		.map(chunk => ({
			chunk,
			score: tokens.reduce((sum, word) => sum + (chunk.text.toLowerCase().includes(word) ? 1 : 0), 0),
		}))
		.filter(item => item.score > 0)
		.sort((a, b) => b.score - a.score);
	const ranks = new Map<string, number>();
	keyword.forEach((item, i) => ranks.set(item.chunk.id, 1 / (60 + i)));
	if (entries && query) {
		const ids = new Set(chunks.map(chunk => chunk.id));
		entries
			.filter(entry => ids.has(entry.id))
			.map(entry => ({ id: entry.id, score: cosine(entry.vector, query) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, 20)
			.forEach((entry, i) => ranks.set(entry.id, (ranks.get(entry.id) || 0) + 1 / (60 + i)));
	}
	return chunks
		.filter(chunk => ranks.has(chunk.id))
		.sort((a, b) => ranks.get(b.id)! - ranks.get(a.id)!)
		.slice(0, 6);
}

export async function digest(value: string | ArrayBuffer): Promise<string> {
	const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x =>
		x.toString(16).padStart(2, '0')).join('');
}

export async function contentFingerprint(doc: DocumentRecord, model: unknown): Promise<string> {
	return digest(
		JSON.stringify({ version: 1, model, pages: Object.values(doc.pages).map(p => [p.number, p.source, p.text]) }),
	);
}

/** DocTags are parsed as data; never insert model output as HTML. */
export function docTagsText(value: string): string {
	return value
		.replace(/<loc_\d+>/g, '')
		.replace(/<(?:fcel|ecel|ched|rhed|srow)>/g, '\t')
		.replace(/<nl>/g, '\n')
		.replace(
			/<\/(?:text|table|otsl|section_header_level_\d|page_header|page_footer|list_item|formula|caption)>/g,
			'\n',
		)
		.replace(/<[^>]*>/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function hasRepeatedVlmBlocks(value: string): boolean {
	const blocks = [...value.matchAll(/<text>([\s\S]*?)<\/text>/g)]
		.map(match => match[1].replace(/<[^>]+>/g, '').trim());
	const tail = blocks.slice(-4);
	return tail.length === 4 && tail[0].length >= 3 && tail.every(text => text === tail[0]);
}

export function translationSegments(text: string, max = 300): string[] {
	const result: string[] = [];
	for (const line of text.split('\n')) {
		if (!line.trim())
			continue;
		for (let i = 0; i < line.length; i += max) result.push(line.slice(i, i + max));
	}
	return result;
}

export function apiEndpoint(url: string): string {
	const parsed = new URL(url);
	if (!['http:', 'https:'].includes(parsed.protocol))
		throw new Error('API 地址必须是 HTTP(S)');
	parsed.pathname = `${parsed.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/chat/completions`;
	return parsed.href;
}
