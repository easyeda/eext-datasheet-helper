export type ImportedModelKind = 'text-generation' | 'feature-extraction' | 'image-text-to-text' | 'translation';

export interface ImportedModel {
	id: string;
	name: string;
	kind: ImportedModelKind;
	size: number;
	fileCount: number;
	files: string[];
	onnxFiles?: Array<{ path: string; dtype: string; label: string }>;
	selectedDtype?: string;
	selectedOnnxFile?: string;
	importedAt: number;
}

const REGISTRY_KEY = 'datasheet_local_models_v1';
const CACHE_PREFIX = 'datasheet-model-';
const CACHE_PATH = '/__datasheet_models__';

function normalizePath(path: string): string {
	return path
		.replaceAll('\\', '/')
		.replace(/^\/+/, '')
		.split('/')
		.filter(part => part && part !== '.')
		.join('/');
}

function modelCacheName(id: string): string {
	return `${CACHE_PREFIX}${id}`;
}

function modelRequest(id: string, path: string): Request {
	return new Request(`${location.origin}${CACHE_PATH}/${id}/${normalizePath(path)}`);
}

export function listImportedModels(): ImportedModel[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]');
		return Array.isArray(parsed) ? parsed : [];
	}
	catch {
		return [];
	}
}

export function getImportedModel(id?: string): ImportedModel | undefined {
	return id ? listImportedModels().find(model => model.id === id) : undefined;
}

export function commitImportedModel(model: ImportedModel): void {
	const models = listImportedModels().filter(item => item.id !== model.id);
	models.push(model);
	localStorage.setItem(REGISTRY_KEY, JSON.stringify(models));
}

export function updateImportedModel(model: ImportedModel): void {
	localStorage.setItem(
		REGISTRY_KEY,
		JSON.stringify(listImportedModels().map(item => (item.id === model.id ? model : item))),
	);
}

export async function deleteImportedModel(id: string): Promise<void> {
	await caches.delete(modelCacheName(id));
	localStorage.setItem(REGISTRY_KEY, JSON.stringify(listImportedModels().filter(model => model.id !== id)));
}

function relativeFiles(files: File[]): Array<{ file: File; path: string }> {
	const paths = files.map(file => normalizePath(file.webkitRelativePath || file.name));
	const firstSegments = paths.map(path => path.split('/')[0]);
	const commonRoot = firstSegments.length > 0 && firstSegments.every(segment => segment === firstSegments[0]);
	return files
		.map((file, index) => ({
			file,
			path: commonRoot ? paths[index].split('/').slice(1).join('/') : paths[index],
		}))
		.filter(item => item.path);
}

function modelKindFromConfig(configFile: File): Promise<ImportedModelKind | undefined> {
	return configFile.text().then((text) => {
		try {
			const config = JSON.parse(text);
			const architectures = Array.isArray(config.architectures) ? config.architectures.join(' ') : '';
			const modelType = `${config.model_type || ''} ${architectures}`.toLowerCase();
			if (config.vision_config || /idefics|vision|vlm/.test(modelType))
				return 'image-text-to-text';
			if (/marian|m2m|mbart|t5/.test(modelType))
				return 'translation';
			if (modelType.includes('bert') || modelType.includes('embedding')) {
				return 'feature-extraction';
			}
			if (
				modelType.includes('causallm')
				|| modelType.includes('qwen')
				|| modelType.includes('llama')
				|| modelType.includes('gemma')
			) {
				return 'text-generation';
			}
		}
		catch {
			return undefined;
		}
		return undefined;
	});
}

function hasModelStructure(paths: string[]): boolean {
	const lower = paths.map(path => path.toLowerCase());
	return (
		lower.includes('config.json')
		&& lower.some(path => path === 'tokenizer.json' || path === 'tokenizer_config.json')
		&& lower.some(path => path.endsWith('.onnx'))
	);
}

function validateStructure(paths: string[]): void {
	if (hasModelStructure(paths)) {
		return;
	}
	throw new Error(
		'The selected folder does not contain config.json, tokenizer files, and an ONNX model at the same model root. Select a model folder such as D:\\model\\Qwen2.5-0.5B, or select D:\\model and choose the matching model type.',
	);
}

function dtypeFromOnnxPath(path: string): { dtype: string; label: string } {
	const file = path.split('/').pop()?.toLowerCase() || path.toLowerCase();
	if (file.includes('q4f16')) {
		return { dtype: 'q4f16', label: 'q4f16' };
	}
	if (file.includes('bnb4')) {
		return { dtype: 'bnb4', label: 'bnb4' };
	}
	if (file.includes('q4')) {
		return { dtype: 'q4', label: 'q4' };
	}
	if (file.includes('int8')) {
		return { dtype: 'int8', label: 'int8' };
	}
	if (file.includes('uint8')) {
		return { dtype: 'uint8', label: 'uint8' };
	}
	if (file.includes('quantized')) {
		return { dtype: 'q8', label: 'q8 / quantized' };
	}
	if (file.includes('fp16')) {
		return { dtype: 'fp16', label: 'fp16' };
	}
	return { dtype: 'fp32', label: 'fp32' };
}

function collectOnnxFiles(paths: string[]): ImportedModel['onnxFiles'] {
	const priority = ['q8', 'q4f16', 'q4', 'int8', 'uint8', 'fp16', 'bnb4', 'fp32'];
	return paths
		.filter(path => path.toLowerCase().endsWith('.onnx'))
		.map((path) => {
			const { dtype, label } = dtypeFromOnnxPath(path);
			return { path, dtype, label: `${label} (${path.split('/').pop()})` };
		})
		.sort((a, b) => priority.indexOf(a.dtype) - priority.indexOf(b.dtype));
}

async function pickModelRoot(
	entries: Array<{ file: File; path: string }>,
	kind: ImportedModelKind,
): Promise<Array<{ file: File; path: string }>> {
	if (hasModelStructure(entries.map(entry => entry.path))) {
		return entries;
	}

	const byRoot = new Map<string, Array<{ file: File; path: string }>>();
	for (const entry of entries) {
		const [root, ...rest] = entry.path.split('/');
		if (!root || rest.length === 0) {
			continue;
		}
		const rootEntries = byRoot.get(root) || [];
		rootEntries.push({ file: entry.file, path: rest.join('/') });
		byRoot.set(root, rootEntries);
	}

	for (const [root, rootEntries] of byRoot) {
		const rootPaths = rootEntries.map(entry => entry.path);
		if (!hasModelStructure(rootPaths)) {
			continue;
		}
		const configEntry = rootEntries.find(entry => entry.path.toLowerCase() === 'config.json');
		const detectedKind = configEntry ? await modelKindFromConfig(configEntry.file) : undefined;
		if (!detectedKind || detectedKind === kind) {
			return rootEntries.map(entry => ({ ...entry, path: entry.path }));
		}
		console.warn(`Skipped ${root}: selected type is ${kind}, detected ${detectedKind}.`);
	}

	return entries;
}

export async function stageImportedModel(
	files: File[],
	kind: ImportedModelKind,
	onProgress?: (written: number, total: number, path: string) => void,
	signal?: AbortSignal,
): Promise<ImportedModel> {
	const entries = await pickModelRoot(relativeFiles(files), kind);
	if (entries.length === 0) {
		throw new Error('No model files were selected.');
	}
	const paths = entries.map(entry => entry.path);
	validateStructure(paths);
	const configFile = entries.find(entry => entry.path === 'config.json')!.file;
	const detectedKind = await modelKindFromConfig(configFile);
	if (detectedKind && detectedKind !== kind)
		throw new Error(`模型类型不匹配：选择 ${kind}，检测到 ${detectedKind}`);
	if (kind === 'image-text-to-text' && !paths.some(path => /(?:preprocessor|processor)_config\.json$/.test(path)))
		throw new Error('视觉模型缺少 preprocessor_config.json 或 processor_config.json');
	if (new Set(paths).size !== paths.length || paths.some(path => path.split('/').includes('..'))) {
		throw new Error('The selected folder contains invalid or duplicate paths.');
	}

	const total = entries.reduce((sum, entry) => sum + entry.file.size, 0);
	const estimate = await navigator.storage?.estimate?.();
	if (estimate?.quota !== undefined && estimate.usage !== undefined) {
		const available = Math.max(0, estimate.quota - estimate.usage);
		if (total * 1.1 > available) {
			throw new Error(
				`Insufficient storage: model needs ${formatBytes(total)}, available ${formatBytes(available)}.`,
			);
		}
	}

	const id = crypto.randomUUID();
	const cache = await caches.open(modelCacheName(id));
	let written = 0;
	try {
		for (const entry of entries) {
			signal?.throwIfAborted();
			await cache.put(
				modelRequest(id, entry.path),
				new Response(entry.file, {
					headers: {
						'content-length': String(entry.file.size),
						'content-type': entry.file.type || 'application/octet-stream',
					},
				}),
			);
			written += entry.file.size;
			signal?.throwIfAborted();
			onProgress?.(written, total, entry.path);
		}
	}
	catch (error) {
		await caches.delete(modelCacheName(id));
		throw error;
	}

	const rootName = normalizePath(files[0].webkitRelativePath || files[0].name).split('/')[0];
	const onnxFiles = collectOnnxFiles(paths);
	const selected = onnxFiles?.[0];
	return {
		id,
		name: rootName || `Imported model ${id.slice(0, 8)}`,
		kind,
		size: total,
		fileCount: entries.length,
		files: paths,
		onnxFiles,
		selectedDtype: selected?.dtype,
		selectedOnnxFile: selected?.path,
		importedAt: Date.now(),
	};
}

export function createImportedModelCache(
	model: ImportedModel,
): Pick<Cache, 'match' | 'put'> & { prepare: () => Promise<void> } {
	let index: Promise<{ cache: Cache; keys: Map<string, Request> }> | undefined;
	const failure = (message: string) =>
		Object.assign(new Error(`Imported model cache: ${message} [${model.name}, ${model.id}]`), {
			name: 'ModelCacheError',
		});
	const loadIndex = () =>
		(index ??= (async () => {
			try {
				if (!(await caches.has(modelCacheName(model.id))))
					throw failure('cache is missing; import this model again');
				const cache = await caches.open(modelCacheName(model.id));
				const keys = new Map<string, Request>();
				const prefix = `${CACHE_PATH}/${model.id}/`;
				for (const request of await cache.keys()) {
					const pathname = decodeURIComponent(new URL(request.url).pathname);
					if (pathname.startsWith(prefix))
						keys.set(normalizePath(pathname.slice(prefix.length)), request);
				}
				for (const path of model.files) {
					if (!keys.has(normalizePath(path)))
						throw failure(`cached file is missing: ${path}; import this model again`);
				}
				return { cache, keys };
			}
			catch (error) {
				if ((error as Error).name === 'ModelCacheError')
					throw error;
				throw failure(`cannot access Cache Storage: ${(error as Error).message}`);
			}
		})());
	return {
		async prepare(): Promise<void> {
			const { cache, keys } = await loadIndex();
			const key = keys.get('config.json');
			const config = key && (await cache.match(key));
			if (!config)
				throw failure('config.json is missing; import this model again');
			try {
				await config.json();
			}
			catch {
				throw failure('config.json is not valid JSON');
			}
		},
		async match(request: RequestInfo | URL): Promise<Response | undefined> {
			const raw = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
			const decoded = decodeURIComponent(raw.split('?')[0]);
			const path = [...model.files]
				.sort((a, b) => b.length - a.length)
				.find(file => decoded.endsWith(`/${file}`) || decoded === file);
			if (!path)
				return undefined;
			const { cache, keys } = await loadIndex();
			const key = keys.get(normalizePath(path));
			// Use the persisted key, not an origin reconstructed inside a Blob Worker.
			const response = key && (await cache.match(key));
			if (!response)
				throw failure(`cached file is missing: ${path}`);
			return response;
		},
		async put(): Promise<void> {
			throw failure('cache is read-only');
		},
	};
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 ** 2) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	if (bytes < 1024 ** 3) {
		return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	}
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
