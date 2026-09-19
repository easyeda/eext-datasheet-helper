import type { DocumentRecord } from './document';
import { migrateDocument } from './document';

let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
	return (database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open('datasheet-local-v1', 1);
		request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	}));
}

export async function saveDocument(record: DocumentRecord): Promise<void> {
	const database = await db();
	await new Promise<void>((resolve, reject) => {
		const tx = database.transaction('documents', 'readwrite');
		tx.objectStore('documents').put(record);
		tx.oncomplete = () => resolve();
		tx.onabort = tx.onerror = () => reject(tx.error || new Error('文档缓存写入失败'));
	});
}

export async function loadDocument(id: string): Promise<DocumentRecord | undefined> {
	const database = await db();
	return new Promise((resolve, reject) => {
		const request = database.transaction('documents').objectStore('documents').get(id);
		request.onsuccess = () => resolve(request.result ? migrateDocument(request.result) : undefined);
		request.onerror = () => reject(request.error);
	});
}

export async function listDocuments(): Promise<Array<{ id: string; name: string }>> {
	const database = await db();
	return new Promise((resolve, reject) => {
		const request = database.transaction('documents').objectStore('documents').openCursor();
		const entries: Array<{ id: string; name: string }> = [];
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) {
				resolve(entries);
				return;
			}
			entries.push({ id: cursor.value.id, name: cursor.value.name });
			cursor.continue();
		};
		request.onerror = () => reject(request.error);
	});
}

export async function deleteDocument(id: string): Promise<void> {
	const database = await db();
	return new Promise((resolve, reject) => {
		const tx = database.transaction('documents', 'readwrite');
		tx.objectStore('documents').delete(id);
		tx.oncomplete = () => resolve();
		tx.onabort = tx.onerror = () => reject(tx.error);
	});
}
