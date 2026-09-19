import type { Settings } from './settings';
import { apiEndpoint } from './document';

export async function streamChat(
	config: Settings['api'],
	messages: Array<{ role: string; content: string }>,
	signal: AbortSignal,
	token: (text: string) => void,
): Promise<void> {
	if (!config.url || !config.model)
		throw new Error('请先填写 API 地址和模型名称');
	const response = await fetch(apiEndpoint(config.url), {
		method: 'POST',
		signal,
		headers: {
			'Content-Type': 'application/json',
			...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
		},
		body: JSON.stringify({ model: config.model, messages, stream: true }),
	});
	if (!response.ok)
		throw new Error(`API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
	if (response.headers.get('content-type')?.includes('application/json')) {
		const data = await response.json();
		if (data.error)
			throw new Error(data.error.message);
		token(data.choices?.[0]?.message?.content || '');
		return;
	}
	if (!response.body)
		throw new Error('API 没有返回响应流');
	await consumeSSE(response.body, token);
}

export async function consumeSSE(body: ReadableStream<Uint8Array>, token: (text: string) => void): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let ended = false;
	const line = (value: string) => {
		if (!value.startsWith('data:'))
			return;
		const data = value.slice(5).trim();
		if (!data)
			return;
		if (data === '[DONE]') {
			ended = true;
			return;
		}
		const item = JSON.parse(data);
		if (item.error)
			throw new Error(item.error.message || 'API 返回错误');
		const content = item.choices?.[0]?.delta?.content;
		if (typeof content === 'string')
			token(content);
	};
	try {
		for (;;) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let end = buffer.indexOf('\n');
			while (end >= 0) {
				const next = buffer.slice(0, end).replace(/\r$/, '');
				buffer = buffer.slice(end + 1);
				line(next);
				if (ended)
					break;
				end = buffer.indexOf('\n');
			}
			if (ended)
				break;
			if (done) {
				if (buffer.trim())
					line(buffer);
				break;
			}
		}
	}
	finally {
		await reader.cancel();
		reader.releaseLock();
	}
}
