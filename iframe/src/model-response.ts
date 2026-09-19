/** Chromium may reject ordinary ArrayBuffers around 2 GB. ORT uses this same fallback. */
export function allocateModelBuffer(size: number): Uint8Array {
	try {
		return new Uint8Array(size);
	}
	catch (error) {
		if (!(error instanceof RangeError))
			throw error;
		try {
			const pages = Math.ceil(size / 65536);
			return new Uint8Array(new WebAssembly.Memory({ initial: pages, maximum: pages }).buffer, 0, size);
		}
		catch {
			throw Object.assign(
				new Error(
					`模型文件需要分配 ${Math.ceil(size / 1024 / 1024)} MiB 连续内存，当前环境无法满足。请关闭其他助手窗口，或使用更小精度的模型。`,
				),
				{ name: 'ModelMemoryError' },
			);
		}
	}
}

export async function readModelResponse(
	response: Response,
	progress: (data: { progress: number; loaded: number; total: number }) => void,
	expectedSize?: number,
): Promise<Uint8Array> {
	const encoding = response.headers.get('content-encoding');
	// Fetch already decompresses the body; Content-Length can still describe compressed bytes.
	const declared
		= encoding && encoding !== 'identity' ? 0 : Number(response.headers.get('content-length')) || expectedSize || 0;
	const total = Number.isSafeInteger(declared) && declared > 0 ? declared : 0;
	const reader = response.body?.getReader();
	if (!reader)
		throw new Error('模型文件响应没有数据流。');
	let loaded = 0;
	try {
		let buffer = allocateModelBuffer(total);
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;
			const needed = loaded + value.length;
			if (needed > buffer.length) {
				// Unknown-length streams must not reallocate and copy the entire model per chunk.
				const expanded = allocateModelBuffer(
					Math.max(needed, Math.min(0xFFFFFFFF, Math.max(65536, buffer.length * 2))),
				);
				expanded.set(buffer.subarray(0, loaded));
				buffer = expanded;
			}
			buffer.set(value, loaded);
			loaded = needed;
			progress({ loaded, total, progress: total ? (loaded / total) * 100 : 0 });
		}
		if (total && loaded !== total)
			throw new Error(`模型文件不完整：预期 ${total} 字节，实际 ${loaded} 字节。`);
		progress({ loaded, total: loaded, progress: 100 });
		return buffer.subarray(0, loaded);
	}
	catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	}
	finally {
		reader.releaseLock();
	}
}

/** Cache Storage consumes small copies instead of Response copying the whole multi-GB buffer. */
export function modelCacheStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset === bytes.length) {
				controller.close();
				return;
			}
			const end = Math.min(offset + 1024 * 1024, bytes.length);
			controller.enqueue(bytes.slice(offset, end));
			offset = end;
		},
	});
}
