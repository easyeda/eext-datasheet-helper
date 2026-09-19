import type { InferenceDevice } from './inference-device';

export type Role = 'chat' | 'embedding' | 'vlm' | 'en-zh' | 'zh-en';
export interface ModelSpec {
	name: string;
	dtype: string;
	importedId?: string;
}
export interface Settings {
	uiVersion?: number;
	vectorByProvider?: { local: boolean; api: boolean };
	pipeline: 'text' | 'vlm';
	vectorEnabled: boolean;
	device: InferenceDevice;
	mirror: string;
	provider: 'local' | 'api';
	api: { url: string; key: string; model: string };
	models: Record<Role, ModelSpec>;
}
export const defaults: Settings = {
	pipeline: 'text',
	vectorEnabled: true,
	device: 'auto',
	mirror: 'https://huggingface.co',
	provider: 'local',
	api: { url: '', key: '', model: '' },
	models: {
		'chat': { name: 'onnx-community/Qwen3-0.6B-ONNX', dtype: 'q4' },
		'embedding': { name: 'Xenova/multilingual-e5-small', dtype: 'q8' },
		'vlm': { name: 'onnx-community/granite-docling-258M-ONNX', dtype: 'fp32' },
		'en-zh': { name: 'Xenova/opus-mt-en-zh', dtype: 'q8' },
		'zh-en': { name: 'onnx-community/opus-mt-zh-en', dtype: 'q8' },
	},
};
export const labels: Record<Role, string> = {
	'chat': 'LLM 问答',
	'embedding': '向量模型',
	'vlm': 'OCR-VLM',
	'en-zh': '英译中',
	'zh-en': '中译英',
};

export async function getConfig(key: string): Promise<unknown> {
	if (typeof eda !== 'undefined')
		return await eda.sys_Storage.getExtensionUserConfig(key);
	return localStorage.getItem(key);
}
export async function putConfig(key: string, value: string): Promise<void> {
	if (typeof eda !== 'undefined') {
		if (!(await eda.sys_Storage.setExtensionUserConfig(key, value)))
			throw new Error('保存设置失败');
	}
	else {
		localStorage.setItem(key, value);
	}
}
export async function loadSettings(): Promise<Settings> {
	const raw = await getConfig('datasheet_local_config_v1');
	const saved = raw ? JSON.parse(String(raw)) : {};
	const result: Settings = {
		...structuredClone(defaults),
		...saved,
		pipeline: saved.pipeline === 'vlm' ? 'vlm' : 'text',
		vectorEnabled: typeof saved.vectorEnabled === 'boolean' ? saved.vectorEnabled : true,
		api: { ...defaults.api, ...saved.api },
		models: { ...structuredClone(defaults.models), ...saved.models },
	};
	if (saved.uiVersion !== 2) {
		const rawOnline = await getConfig('aiConfig');
		const online = typeof rawOnline === 'string' ? JSON.parse(rawOnline) : rawOnline;
		if (!result.api.url && online?.apiBaseUrl) {
			result.api = { url: online.apiBaseUrl, key: online.apiKey || '', model: online.model || '' };
		}
		if (await getConfig('datasheet_mode') === 'online' && result.api.url)
			result.provider = 'api';
		result.uiVersion = 2;
		await putConfig('datasheet_local_config_v1', JSON.stringify(result));
	}
	result.vectorByProvider = { local: saved.vectorByProvider?.local ?? result.vectorEnabled, api: saved.vectorByProvider?.api ?? false };
	result.vectorEnabled = result.vectorByProvider[result.provider];
	return result;
}
