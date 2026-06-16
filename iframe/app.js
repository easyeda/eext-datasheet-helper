/* global pdfjsLib, marked, eda */
/* eslint-disable no-template-curly-in-string */
/**
 * PDF Assistant - iframe application
 * Pure JS PDF extraction with layout analysis + AI chat
 */
(function () {
	'use strict';

	// ===== i18n =====
	const edaObj = (typeof eda !== 'undefined') ? eda : (window.parent && window.parent.eda);
	function t(tag) {
		if (edaObj && edaObj.sys_I18n)
			return edaObj.sys_I18n.text(tag);
		return tag;
	}
	function tArgs(tag, ...args) {
		if (edaObj && edaObj.sys_I18n)
			return edaObj.sys_I18n.text(tag, undefined, undefined, ...args);
		return tag;
	}

	// ===== Config =====
	const STORAGE_KEY = 'pdf_assistant_api_config';
	const DATASHEET_STORAGE_KEY = 'pdf_assistant_pending_datasheets';
	const MAX_CONTEXT_CHARS = 120000;

	const apiConfig = {
		apiUrl: '',
		apiKey: '',
		model: '',
	};

	// ===== State =====
	let pdfContent = '';
	let pdfFileName = '';
	let pdfPageCount = 0;
	let chatHistory = [];
	let isProcessing = false;

	// ===== DOM Elements =====
	const uploadArea = document.getElementById('upload-area');
	const fileInput = document.getElementById('file-input');
	const pdfInfo = document.getElementById('pdf-info');
	const pdfName = document.getElementById('pdf-name');
	const pdfPages = document.getElementById('pdf-pages');
	const chatMessages = document.getElementById('chat-messages');
	const userInput = document.getElementById('user-input');
	const btnSend = document.getElementById('btn-send');
	const btnClear = document.getElementById('btn-clear');
	const btnRemovePdf = document.getElementById('btn-remove-pdf');

	// ===== PDF.js Setup =====
	if (typeof pdfjsLib !== 'undefined') {
		pdfjsLib.GlobalWorkerOptions.workerSrc
			= 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
	}

	// ===== Event Listeners =====
	uploadArea.addEventListener('click', () => fileInput.click());
	fileInput.addEventListener('change', handleFileSelect);

	uploadArea.addEventListener('dragover', (e) => {
		e.preventDefault();
		uploadArea.classList.add('drag-over');
	});
	uploadArea.addEventListener('dragleave', () => {
		uploadArea.classList.remove('drag-over');
	});
	uploadArea.addEventListener('drop', (e) => {
		e.preventDefault();
		uploadArea.classList.remove('drag-over');
		const files = e.dataTransfer.files;
		if (files.length > 0 && files[0].name.toLowerCase().endsWith('.pdf')) {
			processPDFFile(files[0]);
		}
	});

	btnSend.addEventListener('click', sendMessage);
	btnClear.addEventListener('click', clearChat);
	btnRemovePdf.addEventListener('click', removePdf);

	userInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	userInput.addEventListener('input', autoResize);

	// ===== File Handling =====
	function handleFileSelect(e) {
		const file = e.target.files[0];
		if (file) {
			processPDFFile(file);
			fileInput.value = '';
		}
	}

	async function processPDFFile(file) {
		if (typeof pdfjsLib === 'undefined') {
			showStatus(t('PDF.js 库加载失败，请检查网络连接。'), 'error');
			return;
		}

		isProcessing = true;
		updateInputState();
		showStatus(t('正在提取 PDF 并进行版面分析...'), '');

		try {
			const arrayBuffer = await file.arrayBuffer();
			const result = await extractPdfText(arrayBuffer, file.name);

			pdfContent = result.text;
			pdfFileName = file.name;
			pdfPageCount = result.pages;

			uploadArea.classList.add('hidden');
			pdfInfo.classList.remove('hidden');
			pdfName.textContent = pdfFileName;
			pdfPages.textContent = tArgs('（${1} 页，${2}）', pdfPageCount, formatSize(pdfContent.length));
			userInput.disabled = false;
			btnSend.disabled = false;
			userInput.focus();
			isProcessing = false;
			updateInputState();

			removeStatus();
			addSystemMessage(tArgs('PDF 已加载：${1}（${2} 页）', pdfFileName, pdfPageCount));
			chatHistory = [];
		}
		catch (err) {
			console.error('[PDFAssistant] Extraction failed:', err);
			isProcessing = false;
			updateInputState();
			showStatus(tArgs('PDF 提取失败：${1}', err.message), 'error');
		}
	}

	// ===== Core: Structured Page Extraction =====
	async function extractPageStructured(page, _pageNum, _totalPages) {
		const viewport = page.getViewport({ scale: 1.0 });
		const textContent = await page.getTextContent();

		if (!textContent.items || textContent.items.length === 0) {
			return '';
		}

		// Build text items with accurate positions
		const items = textContent.items
			.filter(item => item.str && item.str.trim())
			.map((item) => {
				const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
				const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
				return {
					x: Math.round(item.transform[4] * 10) / 10,
					y: Math.round(item.transform[5] * 10) / 10,
					width: Math.round(item.width * 10) / 10,
					height: Math.round((fontHeight <= 1 ? item.height : fontHeight) * 10) / 10,
					text: item.str,
					font: item.fontName || '',
					fontSize: Math.round(fontHeight * 10) / 10,
				};
			});

		if (items.length === 0)
			return '';

		// Step 1: Detect font sizes for header detection
		const fontSizes = items.map(it => it.fontSize).filter(s => s > 0);
		const bodyFontSize = mode(fontSizes);

		// Step 2: Group items into lines by Y position
		const lines = groupIntoLines(items);

		// Step 3: Detect tables
		const { tables, remainingLines } = detectTables(lines, items);

		// Step 4: Detect columns in remaining lines
		const columnResult = detectColumns(remainingLines);

		// Step 5: Build output
		let output = '';

		// Render tables
		for (const table of tables) {
			output += `${renderTable(table)}\n\n`;
		}

		// Render text (with column awareness)
		if (columnResult.isMultiColumn && columnResult.columns.length > 1) {
			output += renderColumns(columnResult, bodyFontSize);
		}
		else {
			output += renderSingleColumn(remainingLines, bodyFontSize);
		}

		return output.trim();
	}

	// ===== Line Grouping =====
	function groupIntoLines(items) {
		// Sort by Y, then X
		const sorted = [...items].sort((a, b) => {
			const dy = a.y - b.y;
			return Math.abs(dy) > 2 ? dy : a.x - b.x;
		});

		const lines = [];
		let currentLine = null;

		for (const item of sorted) {
			if (!currentLine || Math.abs(item.y - currentLine.y) > 3) {
				currentLine = { y: item.y, items: [item] };
				lines.push(currentLine);
			}
			else {
				currentLine.items.push(item);
				// Update line Y to average
				currentLine.y = (currentLine.y * (currentLine.items.length - 1) + item.y) / currentLine.items.length;
			}
		}

		// Sort items within each line by X
		for (const line of lines) {
			line.items.sort((a, b) => a.x - b.x);
		}

		return lines;
	}

	// ===== Table Detection =====
	function detectTables(lines, _allItems) {
		const tables = [];
		const usedLineIndices = new Set();

		if (lines.length < 3)
			return { tables, remainingLines: lines };

		// Find potential table regions by detecting grid patterns
		// Look for lines where multiple items share similar X positions
		const xPositions = {};
		for (const line of lines) {
			for (const item of line.items) {
				const xKey = Math.round(item.x / 5) * 5; // Round to nearest 5
				xPositions[xKey] = (xPositions[xKey] || 0) + 1;
			}
		}

		// Find X positions that appear in multiple lines (column indicators)
		const threshold = Math.max(3, lines.length * 0.3);
		const columnXs = Object.entries(xPositions)
			.filter(([, count]) => count >= threshold)
			.map(([x]) => Number.parseInt(x))
			.sort((a, b) => a - b);

		if (columnXs.length < 2) {
			return { tables, remainingLines: lines };
		}

		// Find consecutive line groups that have items at these X positions
		let tableStart = -1;
		let tableLines = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineXs = line.items.map(it => Math.round(it.x / 5) * 5);
			const matchCount = columnXs.filter(cx => lineXs.some(lx => Math.abs(lx - cx) < 10)).length;

			if (matchCount >= Math.min(2, columnXs.length)) {
				if (tableStart === -1)
					tableStart = i;
				tableLines.push({ index: i, line });
			}
			else {
				if (tableLines.length >= 3) {
					// Found a table region
					const table = buildTable(tableLines, columnXs);
					if (table) {
						tables.push(table);
						for (const tl of tableLines) {
							usedLineIndices.add(tl.index);
						}
					}
				}
				tableStart = -1;
				tableLines = [];
			}
		}

		// Check last group
		if (tableLines.length >= 3) {
			const table = buildTable(tableLines, columnXs);
			if (table) {
				tables.push(table);
				for (const tl of tableLines) {
					usedLineIndices.add(tl.index);
				}
			}
		}

		const remainingLines = lines.filter((_, i) => !usedLineIndices.has(i));
		return { tables, remainingLines };
	}

	function buildTable(tableLines, columnXs) {
		// Build grid: assign each item to nearest column
		const grid = [];

		for (const { line } of tableLines) {
			const row = Array.from({ length: columnXs.length }, () => '');
			for (const item of line.items) {
				// Find nearest column
				let nearestCol = 0;
				let minDist = Infinity;
				for (let c = 0; c < columnXs.length; c++) {
					const dist = Math.abs(item.x - columnXs[c]);
					if (dist < minDist) {
						minDist = dist;
						nearestCol = c;
					}
				}
				if (minDist < 50) { // Max 50pt distance to column
					row[nearestCol] += (row[nearestCol] ? ' ' : '') + item.text;
				}
			}
			// Only add non-empty rows
			if (row.some(cell => cell.trim())) {
				grid.push(row.map(cell => cell.trim()));
			}
		}

		if (grid.length < 2)
			return null;

		return grid;
	}

	function renderTable(grid) {
		if (!grid || grid.length === 0)
			return '';

		// Calculate column widths
		const numCols = Math.max(...grid.map(row => row.length));
		const colWidths = Array.from({ length: numCols }, () => 3);

		for (const row of grid) {
			for (let i = 0; i < row.length; i++) {
				colWidths[i] = Math.max(colWidths[i], row[i].length + 2);
			}
		}

		const sep = `+${colWidths.map(w => '-'.repeat(w)).join('+')}+`;

		const renderRow = (cells) => {
			const parts = [];
			for (let i = 0; i < numCols; i++) {
				const cell = (cells[i] || '').substring(0, colWidths[i] - 2);
				parts.push(` ${cell.padEnd(colWidths[i] - 2)} `);
			}
			return `|${parts.join('|')}|`;
		};

		const lines = [sep];
		for (let i = 0; i < grid.length; i++) {
			lines.push(renderRow(grid[i]));
			if (i === 0)
				lines.push(sep); // Header separator
		}
		lines.push(sep);

		return lines.join('\n');
	}

	// ===== Column Detection =====
	function detectColumns(lines) {
		if (lines.length < 5) {
			return { isMultiColumn: false, columns: [lines] };
		}

		// Collect all X-start positions
		const xStarts = [];
		for (const line of lines) {
			for (const item of line.items) {
				xStarts.push(item.x);
			}
		}

		if (xStarts.length < 20) {
			return { isMultiColumn: false, columns: [lines] };
		}

		// Build histogram
		const pageWidth = Math.max(...xStarts) + 50;
		const binWidth = 5;
		const numBins = Math.ceil(pageWidth / binWidth);
		const histogram = Array.from({ length: numBins }, () => 0);

		for (const x of xStarts) {
			const bin = Math.floor(x / binWidth);
			if (bin >= 0 && bin < numBins)
				histogram[bin]++;
		}

		// Find significant gaps
		const threshold = Math.max(2, xStarts.length * 0.01);
		const gaps = [];
		let gapStart = -1;

		for (let i = 0; i < numBins; i++) {
			if (histogram[i] <= threshold) {
				if (gapStart === -1)
					gapStart = i;
			}
			else {
				if (gapStart !== -1) {
					const gapWidth = (i - gapStart) * binWidth;
					if (gapWidth > 30) {
						const gapCenter = ((gapStart + i) / 2) * binWidth;
						gaps.push({ x: gapCenter, width: gapWidth });
					}
					gapStart = -1;
				}
			}
		}

		if (gaps.length === 0) {
			return { isMultiColumn: false, columns: [lines] };
		}

		// Use widest gap as column divider
		gaps.sort((a, b) => b.width - a.width);
		const dividerX = gaps[0].x;

		// Split lines into columns
		const leftLines = [];
		const rightLines = [];

		for (const line of lines) {
			const leftItems = line.items.filter(it => it.x < dividerX - 10);
			const rightItems = line.items.filter(it => it.x >= dividerX - 10);

			if (leftItems.length > 0) {
				leftLines.push({ y: line.y, items: leftItems });
			}
			if (rightItems.length > 0) {
				rightLines.push({ y: line.y, items: rightItems });
			}
		}

		if (leftLines.length < 2 || rightLines.length < 2) {
			return { isMultiColumn: false, columns: [lines] };
		}

		return {
			isMultiColumn: true,
			dividerX,
			columns: [leftLines, rightLines],
		};
	}

	function renderColumns(columnResult, bodyFontSize) {
		let output = '';

		for (let colIdx = 0; colIdx < columnResult.columns.length; colIdx++) {
			const colLines = columnResult.columns[colIdx];
			output += `${tArgs('[第 ${1} 列]', colIdx + 1)}\n`;
			output += renderSingleColumn(colLines, bodyFontSize);
			output += '\n\n';
		}

		return output;
	}

	function renderSingleColumn(lines, bodyFontSize) {
		let output = '';
		let prevY = -100;

		for (const line of lines) {
			// Detect paragraph breaks (large Y gap)
			if (prevY > 0 && (line.y - prevY) > bodyFontSize * 2.5) {
				output += '\n';
			}

			// Build line text with spacing
			let lineText = '';
			let prevEndX = 0;

			// Detect headers (larger font)
			const maxFontSize = Math.max(...line.items.map(it => it.fontSize));
			if (maxFontSize > bodyFontSize * 1.25) {
				lineText += t('[章节: ');
			}

			for (let i = 0; i < line.items.length; i++) {
				const item = line.items[i];
				if (i > 0) {
					const gap = item.x - prevEndX;
					if (gap > 20) {
						lineText += '    '; // Large gap
					}
					else if (gap > 3) {
						lineText += ' ';
					}
				}
				lineText += item.text;
				prevEndX = item.x + item.width;
			}

			if (maxFontSize > bodyFontSize * 1.25) {
				lineText += ']';
			}

			output += `${lineText}\n`;
			prevY = line.y;
		}

		return output;
	}

	// ===== Utility =====
	function mode(arr) {
		if (!arr.length)
			return 12;
		const counts = {};
		for (const v of arr) {
			const key = Math.round(v);
			counts[key] = (counts[key] || 0) + 1;
		}
		let maxCount = 0;
		let modeVal = arr[0];
		for (const [val, count] of Object.entries(counts)) {
			if (count > maxCount) {
				maxCount = count;
				modeVal = Number.parseFloat(val);
			}
		}
		return modeVal;
	}

	function removePdf() {
		pdfContent = '';
		pdfFileName = '';
		pdfPageCount = 0;
		chatHistory = [];
		uploadArea.classList.remove('hidden');
		pdfInfo.classList.add('hidden');
		userInput.disabled = true;
		btnSend.disabled = true;
		userInput.value = '';
		autoResize();
	}

	// ===== Chat Functions =====
	async function sendMessage() {
		const text = userInput.value.trim();
		if (!text || isProcessing || !pdfContent)
			return;

		addMessage('user', text);
		userInput.value = '';
		autoResize();

		isProcessing = true;
		updateInputState();
		const { contentDiv, update } = addStreamingMessage();

		let fullText = '';
		try {
			await callAIAPI(text, (chunk) => {
				fullText += chunk;
				update(fullText);
			});

			chatHistory.push({ role: 'user', content: text });
			chatHistory.push({ role: 'assistant', content: fullText });

			if (chatHistory.length > 40) {
				chatHistory = chatHistory.slice(-40);
			}
		}
		catch (err) {
			console.error('[PDFAssistant] API call failed:', err);
			if (fullText) {
				update(`${fullText}\n\n**${t('错误：')}**${err.message}`);
			}
			else {
				contentDiv.parentElement.remove();
				addMessage('error', tArgs('获取 AI 响应失败：${1}', err.message));
			}
		}
		finally {
			isProcessing = false;
			updateInputState();
		}
	}

	async function callAIAPI(question, onChunk) {
		let systemContent = `You are a PDF document analysis assistant. You have been given the extracted text content of a PDF document. Your job is to:
1. Understand the document's structure and content
2. Answer questions about the document accurately
3. Reference specific pages when relevant
4. Preserve important formatting context (tables, lists, sections)

When answering:
- Be precise and cite page numbers when applicable
- If the PDF contains technical data (datasheets, specifications), present the data clearly
- If information is not found in the document, say so explicitly
- Use the same language as the user's question
- Use Markdown formatting for better readability`;

		let contextContent = pdfContent;
		if (contextContent.length > MAX_CONTEXT_CHARS) {
			contextContent = `${contextContent.substring(0, MAX_CONTEXT_CHARS)}\n\n[Content truncated due to length...]`;
		}

		systemContent += `\n\n--- PDF Content ---\n${contextContent}`;

		const messages = [
			{ role: 'system', content: systemContent },
			...chatHistory,
			{ role: 'user', content: question },
		];

		if (!apiConfig.apiUrl || !apiConfig.apiKey || !apiConfig.model) {
			throw new Error(t('API 未配置。请前往 PDF 助手 > 设置 中填写 API URL、密钥和模型。'));
		}

		const response = await fetch(apiConfig.apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiConfig.apiKey}`,
			},
			body: JSON.stringify({
				model: apiConfig.model,
				messages,
				stream: true,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(tArgs('API 错误 ${1}：${2}', response.status, errorText));
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop();

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || !trimmed.startsWith('data: '))
					continue;
				const data = trimmed.slice(6);
				if (data === '[DONE]')
					return;

				try {
					const parsed = JSON.parse(data);
					const delta = parsed.choices?.[0]?.delta?.content;
					if (delta)
						onChunk(delta);
				}
				catch {
					// skip malformed JSON lines
				}
			}
		}
	}

	// ===== UI Helpers =====
	function renderMarkdown(text) {
		if (typeof marked !== 'undefined') {
			return marked.parse(text, { gfm: true, breaks: true });
		}
		return text.replace(/</g, '&lt;').replace(/\n/g, '<br>');
	}

	function addMessage(type, content) {
		const welcome = chatMessages.querySelector('.welcome-message');
		if (welcome)
			welcome.remove();

		const div = document.createElement('div');
		div.className = `message ${type}`;

		const avatar = document.createElement('div');
		avatar.className = 'message-avatar';
		avatar.textContent = type === 'user' ? 'U' : type === 'ai' ? 'AI' : '!';

		const contentDiv = document.createElement('div');
		contentDiv.className = 'message-content';
		if (type === 'ai') {
			contentDiv.innerHTML = renderMarkdown(content);
		}
		else {
			contentDiv.textContent = content;
		}

		div.appendChild(avatar);
		div.appendChild(contentDiv);
		chatMessages.appendChild(div);
		scrollToBottom();
	}

	function addStreamingMessage() {
		const welcome = chatMessages.querySelector('.welcome-message');
		if (welcome)
			welcome.remove();

		const div = document.createElement('div');
		div.className = 'message ai';

		const avatar = document.createElement('div');
		avatar.className = 'message-avatar';
		avatar.textContent = 'AI';

		const contentDiv = document.createElement('div');
		contentDiv.className = 'message-content';
		contentDiv.innerHTML = '<span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span>';

		div.appendChild(avatar);
		div.appendChild(contentDiv);
		chatMessages.appendChild(div);
		scrollToBottom();

		return {
			contentDiv,
			update(text) {
				contentDiv.innerHTML = renderMarkdown(text);
				scrollToBottom();
			},
		};
	}

	function addSystemMessage(text) {
		const div = document.createElement('div');
		div.className = 'status-message success';
		div.textContent = text;
		chatMessages.appendChild(div);
		scrollToBottom();
	}

	function showStatus(text, type) {
		removeStatus();
		const div = document.createElement('div');
		div.className = `status-message ${type || ''}`;
		div.id = 'status-msg';
		div.textContent = text;
		chatMessages.appendChild(div);
		scrollToBottom();
	}

	function removeStatus() {
		const existing = document.getElementById('status-msg');
		if (existing)
			existing.remove();
	}

	function clearChat() {
		chatHistory = [];
		chatMessages.innerHTML = '';
		if (pdfContent) {
			addSystemMessage(tArgs('PDF 已加载：${1}（${2} 页）', pdfFileName, pdfPageCount));
		}
		else {
			chatMessages.innerHTML = `
				<div class="welcome-message">
					<p>${t('你好！我是你的 PDF 助手。')}</p>
					<p>${t('上传 PDF 文件后，可以向我提问任何关于文档内容的问题。')}</p>
				</div>`;
		}
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			chatMessages.scrollTop = chatMessages.scrollHeight;
		});
	}

	function autoResize() {
		userInput.style.height = 'auto';
		userInput.style.height = `${Math.min(userInput.scrollHeight, 120)}px`;
	}

	function updateInputState() {
		userInput.disabled = isProcessing || !pdfContent;
		btnSend.disabled = isProcessing || !pdfContent || !userInput.value.trim();
	}

	function formatSize(chars) {
		if (chars < 1024)
			return `${chars}${t(' 字符')}`;
		if (chars < 1024 * 1024)
			return `${(chars / 1024).toFixed(1)}${t('K 字符')}`;
		return `${(chars / (1024 * 1024)).toFixed(1)}${t('M 字符')}`;
	}

	// ===== URL-based PDF Loading =====
	async function loadPdfFromUrl(url, name) {
		if (typeof pdfjsLib === 'undefined') {
			throw new TypeError(t('PDF.js 库加载失败，请检查网络连接。'));
		}

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		return await extractPdfText(arrayBuffer, name);
	}

	async function extractPdfText(arrayBuffer, name) {
		const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
		const totalPages = pdf.numPages;
		let fullText = '';

		for (let i = 1; i <= totalPages; i++) {
			const page = await pdf.getPage(i);
			const pageText = await extractPageStructured(page, i, totalPages);
			if (pageText.trim()) {
				fullText += `\n\n${tArgs('=== 第 ${1} 页 / 共 ${2} 页 ===', i, totalPages)}\n${pageText}`;
			}
			showStatus(tArgs('正在加载 (${1}/${2}): ${3}', i, totalPages, name), '');
		}

		return { text: fullText.trim(), pages: totalPages };
	}

	async function loadDatasheetsFromSelection(datasheets) {
		isProcessing = true;
		updateInputState();

		let allText = '';
		let totalPages = 0;
		const loadedNames = [];

		for (let i = 0; i < datasheets.length; i++) {
			const ds = datasheets[i];
			showStatus(tArgs('正在加载 (${1}/${2}): ${3}', i + 1, datasheets.length, ds.name), '');

			try {
				const result = await loadPdfFromUrl(ds.url, ds.name);
				if (result.text) {
					allText += `\n\n========== ${tArgs('数据手册: ${1}', ds.name)} ==========\n${result.text}`;
					totalPages += result.pages;
					loadedNames.push(ds.name);
				}
			}
			catch (err) {
				console.warn(`[PDFAssistant] Failed to load datasheet for ${ds.name}:`, err);
				allText += `\n\n========== ${tArgs('数据手册: ${1}', ds.name)} ==========\n${tArgs('[加载失败: ${1}]', err.message)}`;
			}
		}

		if (!loadedNames.length) {
			isProcessing = false;
			updateInputState();
			showStatus(t('所有数据手册加载失败。'), 'error');
			return;
		}

		pdfContent = allText.trim();
		pdfFileName = `${loadedNames.join(', ')} Datasheets`;
		pdfPageCount = totalPages;

		uploadArea.classList.add('hidden');
		pdfInfo.classList.remove('hidden');
		pdfName.textContent = pdfFileName;
		pdfPages.textContent = tArgs('（${1} 页，${2}）', pdfPageCount, formatSize(pdfContent.length));
		userInput.disabled = false;
		btnSend.disabled = false;
		userInput.focus();
		isProcessing = false;
		updateInputState();

		removeStatus();
		addSystemMessage(tArgs('已加载 ${1} 个数据手册：${2}（共 ${3} 页）', loadedNames.length, loadedNames.join(', '), pdfPageCount));
		chatHistory = [];
	}

	// ===== Init: Load API config and check pending datasheets =====
	async function init() {
		try {
			const raw = await eda.sys_Storage.getExtensionUserConfig(STORAGE_KEY);
			if (raw) {
				const config = JSON.parse(raw);
				apiConfig.apiUrl = config.apiUrl || '';
				apiConfig.apiKey = config.apiKey || '';
				apiConfig.model = config.model || '';
			}
		}
		catch (err) {
			console.warn('[PDFAssistant] Failed to load API config:', err);
		}

		if (!apiConfig.apiUrl || !apiConfig.apiKey || !apiConfig.model) {
			addSystemMessage(t('API 未配置。请前往 PDF 助手 > 设置 中填写 API URL、密钥和模型。'));
		}

		// Check for pending datasheets from selection
		try {
			const pendingRaw = await eda.sys_Storage.getExtensionUserConfig(DATASHEET_STORAGE_KEY);
			if (pendingRaw) {
				const datasheets = JSON.parse(pendingRaw);
				// Clear the pending data immediately
				await eda.sys_Storage.setExtensionUserConfig(DATASHEET_STORAGE_KEY, '');
				if (Array.isArray(datasheets) && datasheets.length > 0) {
					await loadDatasheetsFromSelection(datasheets);
				}
			}
		}
		catch (err) {
			console.warn('[PDFAssistant] Failed to load pending datasheets:', err);
		}
	}

	init();
})();
