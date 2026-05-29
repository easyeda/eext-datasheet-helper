const PLUGIN_TAG = '[PDFAssistant]';

export async function openPdfAssistant(): Promise<void> {
	try {
		await eda.sys_IFrame.openIFrame('/iframe/index.html', 850, 640, 'pdf-assistant-chat', {
			title: 'PDF Assistant',
			maximizeButton: true,
			minimizeButton: true,
		});
	}
	catch (err) {
		console.error(PLUGIN_TAG, 'Failed to open PDF Assistant:', err);
		await eda.sys_Dialog.showInformationMessage('Failed to open PDF Assistant.');
	}
}

export async function openSettings(): Promise<void> {
	try {
		await eda.sys_IFrame.openIFrame('/iframe/settings.html', 480, 340, 'pdf-assistant-settings', {
			title: 'PDF Assistant Settings',
			maximizeButton: false,
			minimizeButton: false,
		});
	}
	catch (err) {
		console.error(PLUGIN_TAG, 'Failed to open settings:', err);
	}
}
