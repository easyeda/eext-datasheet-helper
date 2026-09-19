import { env } from '@huggingface/transformers';

declare const __ORT_NATIVE_MJS_SOURCE__: string;
declare const __ORT_NATIVE_WASM_BASE64__: string;
declare const __ORT_LEGACY__: boolean;

let initialized = false;

/** Package-matched native WebGPU assets, shared by CPU and WebGPU in this Worker. */
export function setupOrtRuntime(): void {
	if (initialized)
		return;
	const binary = atob(__ORT_NATIVE_WASM_BASE64__);
	const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
	const wasm = env.backends.onnx.wasm!;
	wasm.wasmPaths = {
		mjs: URL.createObjectURL(new Blob([__ORT_NATIVE_MJS_SOURCE__], { type: 'text/javascript' })),
		wasm: URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' })),
	};
	// Legacy ORT skips locateFile when wasmBinary is supplied, then resolves against
	// the module's blob URL. Let it fetch the explicit wasm blob URL instead.
	if (!__ORT_LEGACY__)
		wasm.wasmBinary = bytes;
	wasm.numThreads = !__ORT_LEGACY__ && globalThis.crossOriginIsolated ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)) : 1;
	wasm.simd = true;
	wasm.proxy = false;
	env.useWasmCache = false;
	initialized = true;
}
