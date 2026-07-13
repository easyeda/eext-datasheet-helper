/**
 * ============================================
 * 数据手册AI问答助手 — IFrame 核心逻辑
 * ============================================
 *
 * 功能模块：
 * 1. 从 eda.sys_Storage 读取当前器件信息
 * 2. 通过 eda.sys_ClientUrl 下载 PDF
 * 3. pdf.js 文本解析 / Tesseract.js OCR 图像解析（按需搜索策略）
 * 4. OpenAI 格式 AI 对话（SSE 流式输出）
 * 5. 对话 UI 交互
 */

(function () {
	'use strict';

	// ============================================
	// 常量与状态
	// ============================================
	var MAX_INITIAL_PAGES = 8;         // 初始解析页数（目录+概述）
	var MAX_CONTEXT_CHARS = 12000;     // 发送给AI的最大上下文字符数
	var MAX_OCR_PAGES = 30;            // OCR最大页数限制
	var OCR_SCALE = 2.0;               // OCR渲染缩放（提高清晰度）
	var PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
	var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/';

	var state = {
		device: null,             // 当前器件信息
		pdfDoc: null,             // pdf.js 文档对象
		pdfBlob: null,            // PDF Blob 数据
		totalPages: 0,            // PDF总页数
		pageTextCache: {},        // 页文本缓存 { pageNum: text }
		ocrPageCache: {},         // OCR结果缓存 { pageNum: text }
		isScannedPdf: null,       // 是否为扫描型PDF
		ocrLang: null,            // OCR语言（自动检测: 'eng' 或 'chi_sim+eng'）
		parsedPages: new Set(),   // 已解析的页号集合
		chatHistory: [],          // 对话历史 [{role, content}]
		isLoadingPdf: false,
		isAsking: false,
		tesseractWorker: null,
	};

	// ============================================
	// DOM 元素引用
	// ============================================
	var el = {};

	function cacheElements() {
		el.chatMessages = document.getElementById('chat-messages');
		el.chatInput = document.getElementById('chat-input');
		el.btnSend = document.getElementById('btn-send');
		el.deviceDesignator = document.getElementById('device-designator');
		el.deviceName = document.getElementById('device-name');
		el.btnConfig = document.getElementById('btn-config');
		el.configPanel = document.getElementById('config-panel');
		el.cfgApiUrl = document.getElementById('cfg-api-url');
		el.cfgApiKey = document.getElementById('cfg-api-key');
		el.cfgModel = document.getElementById('cfg-model');
		el.btnSaveConfig = document.getElementById('btn-save-config');
		el.btnCancelConfig = document.getElementById('btn-cancel-config');
		el.pdfStatusBar = document.getElementById('pdf-status-bar');
		el.pdfStatusText = document.getElementById('pdf-status-text');
		el.pdfProgressTrack = document.getElementById('pdf-progress-track');
		el.pdfProgressFill = document.getElementById('pdf-progress-fill');
		el.pdfPageCount = document.getElementById('pdf-page-count');
		el.pdfSpinner = document.getElementById('pdf-spinner');
		el.pdfSuccessIcon = document.getElementById('pdf-success-icon');
		el.suggestionChips = document.getElementById('suggestion-chips');
		el.pdfFileInput = document.getElementById('pdf-file-input');
		el.btnUploadPdf = document.getElementById('btn-upload-pdf');
	}

	// ============================================
	// AI 配置管理
	// ============================================
	var DEFAULT_CONFIG = {
		apiBaseUrl: 'https://api.openai.com/v1',
		apiKey: '',
		model: 'gpt-4o-mini',
	};

	function getAiConfig() {
		try {
			var stored = eda.sys_Storage.getExtensionUserConfig('aiConfig');
			if (stored) {
				var parsed = JSON.parse(stored);
				return Object.assign({}, DEFAULT_CONFIG, parsed);
			}
		} catch (e) {
			console.warn('Failed to read AI config:', e);
		}
		return Object.assign({}, DEFAULT_CONFIG);
	}

	function saveAiConfig(config) {
		return eda.sys_Storage.setExtensionUserConfig('aiConfig', JSON.stringify(config));
	}

	// ============================================
	// 初始化
	// ============================================
	async function init() {
		cacheElements();
		bindEvents();
		loadConfigToForm();

		// 读取器件信息
		try {
			var raw = eda.sys_Storage.getExtensionUserConfig('currentDevice');
			if (raw) {
				state.device = JSON.parse(raw);
				renderDeviceInfo();
			}
		} catch (e) {
			console.error('Failed to read device info:', e);
		}

		// 如果有数据手册URL，自动开始加载
		if (state.device && state.device.datasheetUrl) {
			await loadPdf(state.device.datasheetUrl);
		}
	}

	function bindEvents() {
		el.btnSend.addEventListener('click', onSendClick);
		el.chatInput.addEventListener('keydown', onInputKeydown);
		el.chatInput.addEventListener('input', autoResizeInput);
		el.btnConfig.addEventListener('click', toggleConfigPanel);
		el.btnSaveConfig.addEventListener('click', onSaveConfigClick);
		el.btnCancelConfig.addEventListener('click', toggleConfigPanel);

		// 上传PDF
		el.btnUploadPdf.addEventListener('click', function () { el.pdfFileInput.click(); });
		el.pdfFileInput.addEventListener('change', handleFileUpload);

		// 建议词点击
		if (el.suggestionChips) {
			el.suggestionChips.addEventListener('click', function (e) {
				if (e.target.classList.contains('chip')) {
					var q = e.target.getAttribute('data-q');
					if (q) {
						el.chatInput.value = q;
						autoResizeInput();
						onSendClick();
					}
				}
			});
		}
	}

	function loadConfigToForm() {
		var cfg = getAiConfig();
		el.cfgApiUrl.value = cfg.apiBaseUrl || '';
		el.cfgApiKey.value = cfg.apiKey || '';
		el.cfgModel.value = cfg.model || '';
	}

	// ============================================
	// 器件信息渲染
	// ============================================
	function renderDeviceInfo() {
		if (!state.device) return;
		el.deviceDesignator.textContent = state.device.designator || '--';
		var name = state.device.manufacturerId || state.device.name || '未知器件';
		el.deviceName.textContent = name;
		el.deviceName.title = [
			'位号: ' + (state.device.designator || ''),
			'型号: ' + (state.device.manufacturerId || ''),
			'制造商: ' + (state.device.manufacturer || ''),
			'供应商编号: ' + (state.device.supplierId || ''),
		].join('\n');
	}

	// ============================================
	// PDF 加载与解析
	// ============================================

	/**
	 * 动态加载 pdf.js 库
	 */
	function loadPdfJs() {
		return new Promise(function (resolve, reject) {
			if (window.pdfjsLib) {
				resolve(window.pdfjsLib);
				return;
			}
			var script = document.createElement('script');
			script.src = PDFJS_CDN + 'build/pdf.min.js';
			script.onload = function () {
				if (window.pdfjsLib) {
					window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'build/pdf.worker.min.js';
					resolve(window.pdfjsLib);
				} else {
					reject(new Error('pdf.js loaded but pdfjsLib not found'));
				}
			};
			script.onerror = function () { reject(new Error('Failed to load pdf.js')); };
			document.head.appendChild(script);
		});
	}

	/**
	 * 下载PDF — 通过 eda.sys_ClientUrl 绕过CORS
	 */
	async function downloadPdf(url) {
		var response = await eda.sys_ClientUrl.request(url, 'GET');
		if (!response.ok) {
			throw new Error('PDF下载失败: HTTP ' + response.status);
		}
		return await response.blob();
	}

	/**
	 * 显示PDF加载进度
	 */
	function setPdfStatus(text, progress, showProgress) {
		el.pdfStatusBar.classList.remove('hidden');
		el.pdfStatusText.textContent = text;
		if (showProgress) {
			el.pdfProgressTrack.classList.remove('hidden');
			el.pdfProgressFill.style.width = (progress || 0) + '%';
		} else {
			el.pdfProgressTrack.classList.add('hidden');
		}
	}

	function setPdfLoaded(pageCount) {
		el.pdfSpinner.classList.add('hidden');
		el.pdfSuccessIcon.classList.remove('hidden');
		el.pdfProgressTrack.classList.add('hidden');
		el.pdfStatusText.textContent = '数据手册已就绪';
		el.pdfPageCount.textContent = pageCount + ' 页';
	}

	function setPdfError(msg) {
		el.pdfSpinner.classList.add('hidden');
		el.pdfProgressTrack.classList.add('hidden');
		el.pdfStatusText.textContent = msg;
		el.pdfStatusText.style.color = 'var(--danger)';
	}

	/**
	 * 处理用户上传的PDF文件
	 */
	function handleFileUpload(e) {
		var file = e.target.files[0];
		if (!file) return;
		if (file.type !== 'application/pdf') {
			addSystemMessage('⚠️ 请选择 PDF 格式的文件');
			return;
		}
		// 更新器件信息显示为文件名
		var displayName = file.name.replace(/\.pdf$/i, '');
		el.deviceName.textContent = displayName;
		el.deviceName.title = '文件: ' + file.name;

		loadPdfFromBlob(file);
		// 重置 input 以允许重复上传同一文件
		e.target.value = '';
	}

	/**
	 * 从 Blob 加载 PDF（供 loadPdf 和用户上传共用）
	 * 包含：加载 pdf.js → 解析文档 → 文本提取 → OCR
	 */
	async function loadPdfFromBlob(blob) {
		// 重置之前的状态
		state.pdfDoc = null;
		state.pdfBlob = null;
		state.totalPages = 0;
		state.pageTextCache = {};
		state.ocrPageCache = {};
		state.isScannedPdf = null;
		state.ocrLang = null;
		state.parsedPages = new Set();
		state.isLoadingPdf = true;

		// 重置状态栏图标
		el.pdfSpinner.classList.remove('hidden');
		el.pdfSuccessIcon.classList.add('hidden');
		el.pdfStatusText.style.color = '';

		setPdfStatus('正在加载PDF解析引擎...', 20, true);

		try {
			state.pdfBlob = blob;

			// 1. 加载 pdf.js
			await loadPdfJs();

			// 2. 打开文档
			setPdfStatus('正在解析文档结构...', 40, true);
			var arrayBuffer = await state.pdfBlob.arrayBuffer();
			state.pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
			state.totalPages = state.pdfDoc.numPages;

			// 3. 解析前N页文本，判断是否为扫描型PDF
			setPdfStatus('正在解析文档内容...', 50, true);
			var pagesToParse = Math.min(MAX_INITIAL_PAGES, state.totalPages);
			var totalTextLength = 0;

			for (var i = 1; i <= pagesToParse; i++) {
				setPdfStatus('解析第 ' + i + '/' + pagesToParse + ' 页...', 50 + (i / pagesToParse) * 40, true);
				var text = await extractPageText(i);
				totalTextLength += text.length;
				state.parsedPages.add(i);
			}

			// 判断：如果前几页平均每页文本 < 50 字符，判定为扫描型PDF
			var avgTextPerPage = totalTextLength / pagesToParse;
			state.isScannedPdf = avgTextPerPage < 50;

			if (state.isScannedPdf) {
				setPdfStatus('检测到扫描型文档，使用OCR解析...', 90, true);

				// 先用英文OCR第1页，检测文档语言
				setPdfStatus('OCR语言检测中（第1页预扫描）...', 90, true);
				var probeText = await ocrPage(1, 'eng');
				state.ocrPageCache[1] = probeText;
				state.ocrLang = detectOcrLanguage(probeText) ? 'chi_sim+eng' : 'eng';
				var langLabel = state.ocrLang === 'chi_sim+eng' ? '中英文' : '英文';
				setPdfStatus('已识别为' + langLabel + '文档，继续OCR...', 90, true);

				// 如果检测到中文，需要用 chi_sim+eng 重新识别第1页
				if (state.ocrLang === 'chi_sim+eng') {
					setPdfStatus('OCR识别第 1/' + pagesToParse + ' 页（中英文模式）...', 90, true);
					probeText = await ocrPage(1, state.ocrLang);
					state.ocrPageCache[1] = probeText;
				}

				// OCR剩余页面
				for (var j = 2; j <= pagesToParse; j++) {
					if (!state.ocrPageCache[j]) {
						setPdfStatus('OCR识别第 ' + j + '/' + pagesToParse + ' 页（' + langLabel + '）...', 90, true);
						var ocrText = await ocrPage(j, state.ocrLang);
						state.ocrPageCache[j] = ocrText;
					}
				}
			}

			setPdfLoaded(state.totalPages);
		} catch (err) {
			console.error('PDF load error:', err);
			var errMsg = err.message || String(err);
			setPdfError('PDF加载失败: ' + errMsg);
			addSystemMessage('⚠️ PDF加载失败: ' + errMsg);
		} finally {
			state.isLoadingPdf = false;
		}
	}

	/**
	 * 主 PDF 加载函数 — 从URL下载后调用 loadPdfFromBlob
	 */
	async function loadPdf(url) {
		if (state.isLoadingPdf) return;
		state.isLoadingPdf = true;
		setPdfStatus('正在下载数据手册...', 0, true);

		try {
			// 1. 下载PDF — 优先用 eda.sys_ClientUrl，失败则回退 fetch
			var blob;
			try {
				blob = await downloadPdf(url);
			} catch (permErr) {
				console.warn('sys_ClientUrl failed, trying fetch fallback:', permErr);
				setPdfStatus('正在通过备用方式下载...', 10, true);
				var fetchResp = await fetch(url, { mode: 'cors' });
				if (!fetchResp.ok) throw new Error('PDF下载失败: HTTP ' + fetchResp.status);
				blob = await fetchResp.blob();
			}

			// 2. 用共享逻辑加载
			state.isLoadingPdf = false;
			await loadPdfFromBlob(blob);
		} catch (err) {
			console.error('PDF load error:', err);
			var errMsg = err.message || String(err);
			if (errMsg.indexOf('外部交互权限') !== -1) {
				setPdfError('需要启用外部交互权限才能下载PDF');
				addSystemMessage('⚠️ 无法下载数据手册：请在扩展管理器中启用本扩展的「外部交互权限」，或检查网络连接。');
			} else {
				setPdfError('数据手册加载失败: ' + errMsg);
				addSystemMessage('⚠️ 数据手册加载失败: ' + errMsg);
			}
			state.isLoadingPdf = false;
		}
	}

	/**
	 * 提取页面文本内容（pdf.js）
	 */
	async function extractPageText(pageNum) {
		if (state.pageTextCache[pageNum]) {
			return state.pageTextCache[pageNum];
		}
		var page = await state.pdfDoc.getPage(pageNum);
		var textContent = await page.getTextContent();
		var text = textContent.items.map(function (item) { return item.str; }).join(' ');
		state.pageTextCache[pageNum] = text;
		return text;
	}

	/**
	 * 检测OCR文本是否包含中文
	 * 如果中文字符占比超过阈值，判定为中文文档
	 */
	function detectOcrLanguage(text) {
		if (!text) return false;
		var chineseCount = 0;
		var totalCount = 0;
		for (var i = 0; i < text.length; i++) {
			var ch = text[i];
			if (ch.trim() === '') continue;
			totalCount++;
			// CJK统一汉字基本区 + 扩展A区
			var code = ch.charCodeAt(0);
			if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)) {
				chineseCount++;
			}
		}
		// 中文字符占比 > 5% 判定为中文文档
		return totalCount > 0 && (chineseCount / totalCount) > 0.05;
	}

	/**
	 * OCR识别单页（Tesseract.js）
	 * @param {number} pageNum - 页码
	 * @param {string} [lang] - OCR语言，'eng' 或 'chi_sim+eng'，默认 'eng'
	 */
	async function ocrPage(pageNum, lang) {
		if (state.ocrPageCache[pageNum]) {
			return state.ocrPageCache[pageNum];
		}
		lang = lang || 'eng';
		var page = await state.pdfDoc.getPage(pageNum);
		var viewport = page.getViewport({ scale: OCR_SCALE });
		var canvas = document.createElement('canvas');
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		var ctx = canvas.getContext('2d');
		await page.render({ canvasContext: ctx, viewport: viewport }).promise;

		// 动态加载 Tesseract.js
		if (!window.Tesseract) {
			await loadTesseract();
		}

		var worker = await window.Tesseract.createWorker(lang, 1, {
			workerPath: TESSERACT_CDN + 'worker.min.js',
			corePath: TESSERACT_CDN + 'tesseract-core.wasm.js',
			langPath: 'https://tessdata.projectnaptha.com/4.0.0',
		});

		var result = await worker.recognize(canvas);
		await worker.terminate();
		var text = result.data.text;
		state.ocrPageCache[pageNum] = text;
		return text;
	}

	/**
	 * 动态加载 Tesseract.js
	 */
	function loadTesseract() {
		return new Promise(function (resolve, reject) {
			var script = document.createElement('script');
			script.src = TESSERACT_CDN + 'tesseract.min.js';
			script.onload = function () { resolve(); };
			script.onerror = function () { reject(new Error('Failed to load Tesseract.js')); };
			document.head.appendChild(script);
		});
	}

	// ============================================
	// 按需搜索策略
	// ============================================

	/**
	 * 根据用户问题，从已解析的页面中搜索相关内容
	 * 如果未找到，尝试解析更多页面
	 */
	async function searchRelevantContent(question) {
		var relevantParts = [];
		var totalChars = 0;

		// 1. 收集所有已解析页面的文本
		var parsedPages = getPageTexts();

		// 2. 关键词匹配
		var keywords = extractKeywords(question);
		var scored = [];

		for (var i = 0; i < parsedPages.length; i++) {
			var score = 0;
			for (var k = 0; k < keywords.length; k++) {
				var regex = new RegExp(escapeRegex(keywords[k]), 'gi');
				var matches = parsedPages[i].text.match(regex);
				if (matches) {
					score += matches.length;
				}
			}
			scored.push({ page: parsedPages[i], score: score });
		}

		// 3. 按相关度排序，取前N页
		scored.sort(function (a, b) { return b.score - a.score; });

		// 4. 如果最高分页面没有命中，尝试解析更多页面
		var maxScore = scored.length > 0 ? scored[0].score : 0;
		if (maxScore === 0 && state.totalPages > state.parsedPages.size) {
			addSystemMessage('🔍 在已解析页面中未找到相关内容，正在搜索更多页面...');
			await parseMorePages(5);
			return searchRelevantContent(question);
		}

		// 5. 提取相关段落
		for (var j = 0; j < scored.length && totalChars < MAX_CONTEXT_CHARS; j++) {
			if (scored[j].score === 0 && j >= 5) continue; // 跳过无关页面
			var chunks = extractRelevantChunks(scored[j].page.text, keywords, 800);
			for (var m = 0; m < chunks.length && totalChars < MAX_CONTEXT_CHARS; m++) {
				relevantParts.push('[Page ' + scored[j].page.pageNum + '] ' + chunks[m]);
				totalChars += chunks[m].length;
			}
		}

		if (relevantParts.length === 0) {
			// fallback: 返回前几页的文本摘要
			for (var n = 0; n < Math.min(3, parsedPages.length) && totalChars < MAX_CONTEXT_CHARS; n++) {
				var excerpt = parsedPages[n].text.substring(0, 2000);
				relevantParts.push('[Page ' + parsedPages[n].pageNum + '] ' + excerpt);
				totalChars += excerpt.length;
			}
		}

		return {
			content: relevantParts.join('\n\n'),
			deviceInfo: state.device,
			totalPages: state.totalPages,
			parsedPages: state.parsedPages.size,
		};
	}

	function getPageTexts() {
		var pages = [];
		for (var i = 1; i <= state.totalPages; i++) {
			var text = state.ocrPageCache[i] || state.pageTextCache[i];
			if (text) {
				pages.push({ pageNum: i, text: text });
			}
		}
		return pages;
	}

	/**
	 * 解析更多页面
	 */
	async function parseMorePages(count) {
		var startPage = state.parsedPages.size + 1;
		var endPage = Math.min(startPage + count - 1, state.totalPages);

		for (var p = startPage; p <= endPage; p++) {
			if (state.parsedPages.has(p)) continue;
			if (state.isScannedPdf) {
				setPdfStatus('OCR识别第 ' + p + '/' + state.totalPages + ' 页...', 0, false);
				var ocrText = await ocrPage(p, state.ocrLang || 'eng');
				state.ocrPageCache[p] = ocrText;
			} else {
				var text = await extractPageText(p);
			}
			state.parsedPages.add(p);
		}
		el.pdfStatusText.textContent = '数据手册已就绪';
	}

	/**
	 * 从文本中提取关键词
	 */
	function extractKeywords(question) {
		var stopwords = ['the', 'a', 'an', 'is', 'are', 'what', 'how', 'why', 'which',
			'的', '了', '是', '在', '有', '和', '与', '或', '请', '告诉', '我',
			'什么', '怎么', '为什么', '哪个', '哪些', '可以', '吗', '呢', '吧'];
		var words = question.split(/[\s,，。.!！？?;；:：()（）\[\]【】""''`'']+/);
		var keywords = [];
		for (var i = 0; i < words.length; i++) {
			var w = words[i].trim().toLowerCase();
			if (w.length > 1 && stopwords.indexOf(w) === -1) {
				keywords.push(w);
			}
		}
		// 额外提取连续的英文+数字组合（如 "VCC", "VIN", "3.3V", "Pin1"）
		var techTerms = question.match(/[a-zA-Z]+[0-9]+|[0-9]+[a-zA-Z]+|[a-zA-Z]{2,}/g);
		if (techTerms) {
			for (var j = 0; j < techTerms.length; j++) {
				var t = techTerms[j].toLowerCase();
				if (keywords.indexOf(t) === -1 && stopwords.indexOf(t) === -1) {
					keywords.push(t);
				}
			}
		}
		return keywords;
	}

	/**
	 * 从页面文本中提取包含关键词的段落
	 */
	function extractRelevantChunks(text, keywords, maxLen) {
		var lines = text.split(/\n+/);
		var chunks = [];
		var currentChunk = '';

		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if (!line) continue;
			var hasKeyword = false;
			for (var k = 0; k < keywords.length; k++) {
				if (line.toLowerCase().indexOf(keywords[k]) !== -1) {
					hasKeyword = true;
					break;
				}
			}
			if (hasKeyword) {
				if (currentChunk.length + line.length > maxLen) {
					if (currentChunk) chunks.push(currentChunk);
					currentChunk = line;
				} else {
					currentChunk += (currentChunk ? '\n' : '') + line;
				}
			} else if (currentChunk) {
				if (currentChunk.length + line.length <= maxLen) {
					currentChunk += '\n' + line;
				} else {
					chunks.push(currentChunk);
					currentChunk = '';
				}
			}
		}
		if (currentChunk) chunks.push(currentChunk);
		return chunks.length > 0 ? chunks : [text.substring(0, maxLen)];
	}

	function escapeRegex(str) {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	// ============================================
	// AI 对话（OpenAI 格式 + SSE 流式）
	// ============================================

	async function askAI(question) {
		var config = getAiConfig();
		if (!config.apiKey) {
			addSystemMessage('⚠️ 请先点击右上角⚙设置，配置API Key');
			toggleConfigPanel();
			return;
		}

		state.isAsking = true;
		el.btnSend.classList.add('loading');
		el.btnSend.disabled = true;

		// 创建AI消息气泡（用于流式追加）
		var aiMsgEl = addMessage('ai', '');
		var bubbleEl = aiMsgEl.querySelector('.msg-bubble');
		var typingEl = document.createElement('div');
		typingEl.className = 'typing-indicator';
		typingEl.innerHTML = '<span></span><span></span><span></span>';
		bubbleEl.appendChild(typingEl);

		try {
			// 1. 搜索相关内容
			setPdfStatus('搜索相关内容...', 0, false);
			var context = await searchRelevantContent(question);

			// 2. 构建消息
			var systemPrompt = buildSystemPrompt(context);
			var messages = [
				{ role: 'system', content: systemPrompt },
			];
			// 添加历史对话（最多保留最近6条）
			var recentHistory = state.chatHistory.slice(-6);
			messages = messages.concat(recentHistory);
			messages.push({ role: 'user', content: question });

			// 3. 记录用户消息
			state.chatHistory.push({ role: 'user', content: question });

			// 4. 发起流式请求
			typingEl.remove();
			var fullResponse = '';

			var requestBody = JSON.stringify({
				model: config.model,
				messages: messages,
				stream: true,
				temperature: 0.3,
				max_tokens: 2000,
			});

			var response;
			try {
				response = await eda.sys_ClientUrl.request(
					config.apiBaseUrl.replace(/\/+$/, '') + '/chat/completions',
					'POST',
					requestBody,
					{
						headers: {
							'Content-Type': 'application/json',
							'Authorization': 'Bearer ' + config.apiKey,
						},
					}
				);
			} catch (permErr) {
				console.warn('sys_ClientUrl failed for AI request, trying fetch:', permErr);
				response = await fetch(
					config.apiBaseUrl.replace(/\/+$/, '') + '/chat/completions',
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': 'Bearer ' + config.apiKey,
						},
						body: requestBody,
					}
				);
			}

			if (!response.ok) {
				var errorText = await response.text();
				throw new Error('AI请求失败 (' + response.status + '): ' + errorText.substring(0, 200));
			}

			// 5. 解析SSE流
			var reader = response.body.getReader();
			var decoder = new TextDecoder();
			var buffer = '';

			while (true) {
				var chunk = await reader.read();
				if (chunk.done) break;

				buffer += decoder.decode(chunk.value, { stream: true });
				var lines = buffer.split('\n');
				buffer = lines.pop();

				for (var i = 0; i < lines.length; i++) {
					var line = lines[i].trim();
					if (!line || !line.startsWith('data: ')) continue;
					var data = line.slice(6);
					if (data === '[DONE]') break;

					try {
						var json = JSON.parse(data);
						var delta = json.choices && json.choices[0] && json.choices[0].delta;
						if (delta && delta.content) {
							fullResponse += delta.content;
							renderMarkdown(bubbleEl, fullResponse);
							scrollToBottom();
						}
					} catch (e) {
						// 忽略解析错误的行
					}
				}
			}

			if (!fullResponse) {
				bubbleEl.textContent = '(AI未返回内容)';
			}

			// 记录AI回复
			state.chatHistory.push({ role: 'assistant', content: fullResponse });
			el.pdfStatusText.textContent = '数据手册已就绪';
		} catch (err) {
			console.error('AI request error:', err);
			typingEl.remove();
			aiMsgEl.classList.add('error');
			bubbleEl.textContent = '❌ ' + (err.message || err);
		} finally {
			state.isAsking = false;
			el.btnSend.classList.remove('loading');
			el.btnSend.disabled = false;
		}
	}

	/**
	 * 构建系统提示词
	 */
	function buildSystemPrompt(context) {
		var parts = [];
		parts.push('你是一个专业的电子元器件数据手册分析助手。');
		parts.push('请根据以下从器件数据手册中提取的内容来回答用户的问题。');
		parts.push('');
		if (context.deviceInfo) {
			parts.push('当前器件信息：');
			parts.push('- 位号: ' + (context.deviceInfo.designator || '未知'));
			parts.push('- 型号: ' + (context.deviceInfo.manufacturerId || '未知'));
			parts.push('- 制造商: ' + (context.deviceInfo.manufacturer || '未知'));
			parts.push('- 供应商编号: ' + (context.deviceInfo.supplierId || '未知'));
			parts.push('');
		}
		parts.push('数据手册总页数: ' + context.totalPages);
		parts.push('已解析页数: ' + context.parsedPages);
		parts.push('');
		parts.push('=== 数据手册内容片段 ===');
		parts.push(context.content || '(暂无内容)');
		parts.push('=== 内容片段结束 ===');
		parts.push('');
		parts.push('要求：');
		parts.push('1. 根据上方数据手册内容回答问题，不要编造信息');
		parts.push('2. 如果数据手册中没有相关信息，请明确告知');
		parts.push('3. 涉及具体参数时请给出具体数值和单位');
		parts.push('4. 回答使用中文');
		return parts.join('\n');
	}

	// ============================================
	// UI 渲染
	// ============================================

	/**
	 * 添加一条消息到对话区
	 */
	function addMessage(role, content) {
		// 移除欢迎消息
		var welcome = el.chatMessages.querySelector('.welcome-msg');
		if (welcome) welcome.remove();

		var msgDiv = document.createElement('div');
		msgDiv.className = 'msg ' + role;

		var avatar = document.createElement('div');
		avatar.className = 'msg-avatar';
		avatar.textContent = role === 'user' ? '你' : 'AI';

		var bubble = document.createElement('div');
		bubble.className = 'msg-bubble';

		if (content) {
			renderMarkdown(bubble, content);
		}

		msgDiv.appendChild(avatar);
		msgDiv.appendChild(bubble);
		el.chatMessages.appendChild(msgDiv);
		scrollToBottom();

		return msgDiv;
	}

	function addSystemMessage(text) {
		var div = document.createElement('div');
		div.className = 'msg ai';
		div.style.opacity = '0.7';

		var bubble = document.createElement('div');
		bubble.className = 'msg-bubble';
		bubble.style.fontStyle = 'italic';
		bubble.textContent = text;

		div.appendChild(bubble);
		el.chatMessages.appendChild(div);
		scrollToBottom();
	}

	/**
	 * 简易 Markdown 渲染
	 */
	function renderMarkdown(el, text) {
		var html = escapeHtml(text);

		// 代码块
		html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
			return '<pre><code>' + code.trim() + '</code></pre>';
		});

		// 行内代码
		html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

		// 粗体
		html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

		// 斜体
		html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

		// 表格（简易处理）
		html = renderTables(html);

		// 列表
		html = renderLists(html);

		// 段落
		var paragraphs = html.split(/\n\n+/);
		html = paragraphs.map(function (p) {
			p = p.trim();
			if (!p) return '';
			if (p.startsWith('<pre>') || p.startsWith('<table>') || p.startsWith('<ul>') || p.startsWith('<ol>')) return p;
			return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
		}).join('');

		el.innerHTML = html;
	}

	function renderTables(html) {
		var lines = html.split('\n');
		var result = [];
		var inTable = false;
		var tableLines = [];

		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if (line.startsWith('|') && line.endsWith('|')) {
				inTable = true;
				tableLines.push(line);
			} else {
				if (inTable) {
					result.push(buildTable(tableLines));
					tableLines = [];
					inTable = false;
				}
				result.push(line);
			}
		}
		if (inTable && tableLines.length > 0) {
			result.push(buildTable(tableLines));
		}
		return result.join('\n');
	}

	function buildTable(lines) {
		if (lines.length < 2) return lines.join('\n');
		var rows = lines.map(function (l) {
			return l.slice(1, -1).split('|').map(function (c) { return c.trim(); });
		});
		// 检查第二行是否为分隔行
		var startIdx = 1;
		if (rows[1] && rows[1].every(function (c) { return /^[-:]+$/.test(c); })) {
			startIdx = 2;
		}
		var html = '<table><thead><tr>';
		for (var h = 0; h < rows[0].length; h++) {
			html += '<th>' + rows[0][h] + '</th>';
		}
		html += '</tr></thead><tbody>';
		for (var r = startIdx; r < rows.length; r++) {
			html += '<tr>';
			for (var c = 0; c < rows[r].length; c++) {
				html += '<td>' + rows[r][c] + '</td>';
			}
			html += '</tr>';
		}
		html += '</tbody></table>';
		return html;
	}

	function renderLists(html) {
		var lines = html.split('\n');
		var result = [];
		var inUl = false;
		var inOl = false;

		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			var ulMatch = line.match(/^[ \t]*[-*+]\s+(.+)/);
			var olMatch = line.match(/^[ \t]*\d+\.\s+(.+)/);

			if (ulMatch) {
				if (inOl) { result.push('</ol>'); inOl = false; }
				if (!inUl) { result.push('<ul>'); inUl = true; }
				result.push('<li>' + ulMatch[1] + '</li>');
			} else if (olMatch) {
				if (inUl) { result.push('</ul>'); inUl = false; }
				if (!inOl) { result.push('<ol>'); inOl = true; }
				result.push('<li>' + olMatch[1] + '</li>');
			} else {
				if (inUl) { result.push('</ul>'); inUl = false; }
				if (inOl) { result.push('</ol>'); inOl = false; }
				result.push(line);
			}
		}
		if (inUl) result.push('</ul>');
		if (inOl) result.push('</ol>');
		return result.join('\n');
	}

	function escapeHtml(text) {
		var div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function scrollToBottom() {
		requestAnimationFrame(function () {
			el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
		});
	}

	// ============================================
	// 事件处理
	// ============================================

	async function onSendClick() {
		if (state.isAsking || state.isLoadingPdf) return;

		var question = el.chatInput.value.trim();
		if (!question) return;

		el.chatInput.value = '';
		autoResizeInput();

		addMessage('user', question);
		await askAI(question);
	}

	function onInputKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			onSendClick();
		}
	}

	function autoResizeInput() {
		el.chatInput.style.height = 'auto';
		el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 120) + 'px';
	}

	function toggleConfigPanel() {
		el.configPanel.classList.toggle('hidden');
	}

	async function onSaveConfigClick() {
		var config = {
			apiBaseUrl: el.cfgApiUrl.value.trim() || DEFAULT_CONFIG.apiBaseUrl,
			apiKey: el.cfgApiKey.value.trim(),
			model: el.cfgModel.value.trim() || DEFAULT_CONFIG.model,
		};
		await saveAiConfig(config);
		el.configPanel.classList.add('hidden');
	}

	// ============================================
	// 启动
	// ============================================
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
