import type { Role, Settings } from './settings';
// @ts-expect-error esbuild text asset
import workerSource from '../local-worker.txt';
// @ts-expect-error esbuild text asset; VLM uses the upstream example's isolated runtime.
import vlmWorkerSource from '../vlm-worker.txt';
import { selectDevice } from './inference-device';
import { getImportedModel } from './model-store';

export class Inference {
	private worker?: Worker;
	private sequence = 0;
	private cancelRequest?: () => void;
	private signature = '';
	private backend = '';
	private epoch = 0;
	constructor(private progress: (text: string) => void) {}
	dispose(): void {
		this.epoch++;
		this.cancelRequest?.();
		this.worker?.terminate();
		this.worker = undefined;
		this.signature = '';
	}

	private request(type: string, payload: unknown, token?: (text: string) => void): Promise<any> {
		const worker = this.worker!;
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout>;
			let receive: (event: MessageEvent) => void;
			let failure: () => void;
			const cleanup = () => {
				clearTimeout(timer);
				worker.removeEventListener('message', receive);
				worker.removeEventListener('error', failure);
				worker.removeEventListener('messageerror', failure);
				this.cancelRequest = undefined;
			};
			const fail = (error: Error) => {
				cleanup();
				reject(error);
			};
			const arm = () => {
				clearTimeout(timer);
				timer = setTimeout(
					() => fail(new Error('模型长时间无响应，请取消后检查模型、设备或网络')),
					type === 'init' ? 300_000 : 180_000,
				);
			};
			receive = (event: MessageEvent) => {
				const data = event.data;
				if (data.id !== id)
					return;
				arm();
				if (data.type === 'progress')
					this.progress(data.text);
				if (data.type === 'token')
					token?.(data.text);
				if (data.type === 'error')
					fail(Object.assign(new Error(data.text), { name: data.name }));
				if (data.type === 'done') {
					cleanup();
					resolve(data.result);
				}
			};
			failure = () => fail(new Error('推理 Worker 失败，可能是模型不兼容或内存不足'));
			this.cancelRequest = () => fail(new DOMException('已取消', 'AbortError'));
			worker.addEventListener('message', receive);
			worker.addEventListener('error', failure);
			worker.addEventListener('messageerror', failure);
			arm();
			worker.postMessage({ id, type, payload });
		});
	}

	async run(
		role: Role,
		type: string,
		payload: unknown,
		config: Settings,
		token?: (text: string) => void,
	): Promise<any> {
		const signature = JSON.stringify([role, config.models[role], config.device, config.mirror]);
		if (signature !== this.signature)
			this.dispose();
		const epoch = this.epoch;
		let emitted = false;
		const attempt = async (cpu = false) => {
			if (!this.worker) {
				const backend = cpu ? 'wasm' : await selectDevice(config.device);
				if (epoch !== this.epoch)
					throw new DOMException('已取消', 'AbortError');
				this.backend = backend;
				const url = URL.createObjectURL(
					new Blob([role === 'vlm' ? vlmWorkerSource : workerSource], { type: 'text/javascript' }),
				);
				try {
					this.worker = new Worker(url, { type: 'module', name: `datasheet-${role}` });
				}
				finally {
					URL.revokeObjectURL(url);
				}
				const spec = config.models[role];
				const imported = getImportedModel(spec.importedId);
				if (spec.importedId && !imported)
					throw new Error('导入模型缓存不存在，请重新导入');
				await this.request('init', {
					role,
					spec,
					backend,
					mirror: config.mirror,
					imported,
				});
				this.signature = signature;
			}
			this.progress(`${role} · ${this.backend === 'webgpu' ? 'GPU' : 'CPU'} 推理中`);
			if (type === 'init')
				return this.backend;
			return this.request(type, payload, (text) => {
				emitted = true;
				token?.(text);
			});
		};
		try {
			return await attempt();
		}
		catch (error) {
			if (epoch !== this.epoch)
				throw error;
			const alignmentFailure = /operation does not support unaligned accesses/i.test((error as Error).message);
			const gpuFailure = alignmentFailure || /webgpu|GPU|device lost|shader|buffer binding/i.test((error as Error).message);
			if (
				epoch === this.epoch
				&& config.device === 'auto'
				&& this.backend === 'webgpu'
				&& !emitted
				&& gpuFailure
			) {
				this.worker?.terminate();
				this.worker = undefined;
				this.signature = '';
				this.progress('GPU 失败，使用新的 CPU Worker 重试');
				try {
					return await attempt(true);
				}
				catch (retryError) {
					this.dispose();
					throw retryError;
				}
			}
			this.dispose();
			if (alignmentFailure) {
				const spec = config.models[role];
				throw new Error(
					`模型运行库内存对齐失败（${spec.name}，${spec.dtype}，${this.backend === 'webgpu' ? 'WebGPU' : 'CPU'}）。${emitted ? '本次回答已中断，不能作为完整答案。' : ''}${this.backend === 'webgpu' ? '请在设置中选择 CPU 后重新提问。' : 'CPU 也发生此错误，请更换兼容模型或使用在线 API。'} 原始错误：${(error as Error).message}`,
				);
			}
			throw error;
		}
	}
}
