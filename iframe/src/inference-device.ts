export type InferenceDevice = 'auto' | 'cpu' | 'webgpu';
export type ExecutionDevice = 'wasm' | 'webgpu';

export function normalizeDevice(value: unknown): InferenceDevice {
	if (value === 'cpu' || value === 'wasm')
		return 'cpu';
	return value === 'webgpu' ? value : 'auto';
}

export async function hasWebGPU(): Promise<boolean> {
	try {
		const gpu = (
			globalThis.navigator as Navigator & {
				gpu?: { requestAdapter: (options: { powerPreference: string }) => Promise<unknown> };
			}
		)?.gpu;
		return !!(await gpu?.requestAdapter({ powerPreference: 'high-performance' }));
	}
	catch {
		return false;
	}
}

export async function selectDevice(preference: unknown): Promise<ExecutionDevice> {
	const value = normalizeDevice(preference);
	if (value === 'cpu')
		return 'wasm';
	if (await hasWebGPU())
		return 'webgpu';
	if (value === 'webgpu')
		throw new Error('WebGPU unavailable. Select Auto or CPU.');
	return 'wasm';
}
