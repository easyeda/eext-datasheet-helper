const PLUGIN_TAG = '[PDFAssistant]';
const DATASHEET_STORAGE_KEY = 'pdf_assistant_pending_datasheets';
const DATASHEET_IFRAME_ID = 'pdf-assistant-chat';

export async function openPdfAssistant(): Promise<void> {
	try {
		await eda.sys_IFrame.openIFrame('/iframe/index.html', 850, 640, DATASHEET_IFRAME_ID, {
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

export async function openDatasheetFromSelection(): Promise<void> {
	try {
		// Determine current editor type
		const docInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
		if (!docInfo) {
			console.warn(PLUGIN_TAG, 'No active document found');
			await eda.sys_Dialog.showInformationMessage('No active document found. Please open a schematic or PCB document first.');
			return;
		}

		const docType = docInfo.documentType; // SCH=1, PCB=3
		let selectedPrimitives: any[];

		if (docType === 1) {
			selectedPrimitives = await eda.sch_SelectControl.getAllSelectedPrimitives();
		}
		else if (docType === 3) {
			selectedPrimitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
		}
		else {
			console.warn(PLUGIN_TAG, 'Unsupported document type:', docType);
			await eda.sys_Dialog.showInformationMessage('Please open a schematic or PCB document and select components.');
			return;
		}

		if (!selectedPrimitives || selectedPrimitives.length === 0) {
			await eda.sys_Dialog.showInformationMessage('No components selected. Please select components with a Datasheet property first.');
			return;
		}

		// Extract Datasheet URLs from selected components
		const datasheets: Array<{ name: string; url: string }> = [];

		for (const prim of selectedPrimitives) {
			try {
				const designator = prim.getState_Designator?.() || 'Unknown';
				const otherProps = prim.getState_OtherProperty?.();
				if (!otherProps)
					continue;

				const datasheet = otherProps.Datasheet || otherProps.datasheet;
				if (datasheet && typeof datasheet === 'string' && datasheet.startsWith('http')) {
					datasheets.push({ name: designator, url: datasheet });
				}
			}
			catch (err) {
				console.warn(PLUGIN_TAG, 'Failed to read component properties:', err);
			}
		}

		if (datasheets.length === 0) {
			await eda.sys_Dialog.showInformationMessage('No Datasheet URL found in selected components. Please ensure the selected components have a Datasheet property with a valid URL.');
			return;
		}

		// Store datasheets for iframe to pick up
		await eda.sys_Storage.setExtensionUserConfig(DATASHEET_STORAGE_KEY, JSON.stringify(datasheets));

		// Open the PDF Assistant iframe
		await eda.sys_IFrame.openIFrame('/iframe/index.html', 850, 640, DATASHEET_IFRAME_ID, {
			title: `PDF Assistant (${datasheets.length} datasheets)`,
			maximizeButton: true,
			minimizeButton: true,
		});
	}
	catch (err) {
		console.error(PLUGIN_TAG, 'Failed to open datasheet from selection:', err);
		await eda.sys_Dialog.showInformationMessage('Failed to load datasheets. Check console for details.');
	}
}
