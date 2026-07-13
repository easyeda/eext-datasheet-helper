/**
 * 数据手册AI问答助手 - 扩展主入口
 *
 * 功能流程：
 * 1. 用户在原理图中选中器件
 * 2. 点击菜单 → 获取器件数据手册URL
 * 3. 打开IFrame对话窗口
 */

import * as extensionConfig from '../extension.json';

// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {}

/**
 * 打开AI问答窗口
 * 获取选中器件的数据手册URL，存入Storage后打开IFrame
 */
export async function onOpenChat(): Promise<void> {
	try {
		// 1. 尝试获取选中器件信息（可选）
		let deviceInfo = {
			designator: '',
			name: '',
			manufacturer: '',
			manufacturerId: '',
			supplier: '',
			supplierId: '',
			datasheetUrl: '',
		};

		try {
			const selectedIds = await eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId();
			if (selectedIds && selectedIds.length > 0) {
				const components = await eda.sch_PrimitiveComponent.get(selectedIds);
				if (components && components.length > 0) {
					// 过滤出 Component 类型的器件
					let targetComp = null;
					for (const comp of components) {
						const compType = comp.getState_ComponentType();
						if (compType === 'part' || compType === 'component') {
							targetComp = comp;
							break;
						}
					}
					if (!targetComp) {
						targetComp = components[0];
					}

					// 提取器件信息
					const otherProp = targetComp.getState_OtherProperty();
					const datasheetUrl = otherProp?.['Datasheet'] || otherProp?.['datasheet'] || '';

					deviceInfo = {
						designator: targetComp.getState_Designator() || '',
						name: targetComp.getState_Name() || '',
						manufacturer: targetComp.getState_Manufacturer() || '',
						manufacturerId: targetComp.getState_ManufacturerId() || '',
						supplier: targetComp.getState_Supplier() || '',
						supplierId: targetComp.getState_SupplierId() || '',
						datasheetUrl,
					};
				}
			}
		} catch (e) {
			// 获取器件信息失败不影响打开窗口，用户可手动上传PDF
			console.warn('获取器件信息失败:', e);
		}

		// 2. 存入Storage供IFrame读取
		await eda.sys_Storage.setExtensionUserConfig('currentDevice', JSON.stringify(deviceInfo));

		// 3. 打开IFrame对话窗口
		await eda.sys_IFrame.openIFrame('/iframe/chat.html', 500, 680, 'datasheet-chat', {
			title: '数据手册AI助手',
			maximizeButton: true,
			minimizeButton: true,
			minimizeStyle: 'collapsed',
		});
	} catch (err) {
		eda.sys_Dialog.showInformationMessage(
			`打开失败: ${err instanceof Error ? err.message : String(err)}`,
			'错误',
		);
	}
}

/**
 * 关于
 */
export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		`${extensionConfig.displayName} v${extensionConfig.version}`,
		'关于',
	);
}
