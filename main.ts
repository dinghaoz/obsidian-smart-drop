import {
  App,
  Editor,
  htmlToMarkdown,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting
} from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class SmartDropPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');


		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));


		this.app.workspace.on(
			"editor-paste",
			(evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				console.log("editor-past")
				if (evt.clipboardData === null) { return }
				if (!evt.defaultPrevented) {
					evt.preventDefault()
				}
				this.onEditorDataTransfer(evt.clipboardData, editor, info)
			}
		)

		this.app.workspace.on(
			"editor-drop",
			(evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				console.log("editor-drop")
				if (evt.dataTransfer === null) { return }
              if (!evt.defaultPrevented) {
                evt.preventDefault()
              }
				this.onEditorDataTransfer(evt.dataTransfer, editor, info)
			}
		)
	}


	private async onEditorDataTransfer(dataTransfer: DataTransfer, editor: Editor, _: MarkdownView | MarkdownFileInfo) {


		const uriList = dataTransfer.getData("text/uri-list")
		const html = dataTransfer.getData("text/html")
		const plain = dataTransfer.getData("text/plain")

      	console.log("uri-list", uriList)
      	console.log("html", html)
      	console.log("plain", plain)

	  	if (html.length == 0) { return }
		const markdown = htmlToMarkdown(html)

      	console.log("markdown", markdown)

	  	editor.replaceSelection(markdown)


		try {
			// const activeFile = this.getCurrentNote()
			// const fItems = evt.clipboardData.files
			// const tItems = evt.clipboardData.items
			//
			// for (const key in tItems) {
			//
			// 	// Check if it was a text/html
			// 	if (tItems[key].kind == "string") {
			//
			// 		if (this.settings.realTimeUpdate) {
			// 			const cont = htmlToMarkdown(evt.clipboardData.getData("text/html")) +
			// 				htmlToMarkdown(evt.clipboardData.getData("text"))
			// 			for (const reg_p of MD_SEARCH_PATTERN) {
			// 				if (reg_p.test(cont)) {
			//
			// 					showBalloon("Media links were found, processing...", this.settings.showNotifications)
			//
			// 					this.enqueueActivePage(activeFile)
			// 					this.setupQueueInterval()
			// 					break
			// 				}
			// 			}
			// 		}
			// 		return
			// 	}
			//
			// }
		} catch (e) {
			new Notice(`Error ${e}`)
			return
		}
	}


	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// class SampleModal extends Modal {
// 	constructor(app: App) {
// 		super(app);
// 	}
//
// 	onOpen() {
// 		const {contentEl} = this;
// 		contentEl.setText('Woah!');
// 	}
//
// 	onClose() {
// 		const {contentEl} = this;
// 		contentEl.empty();
// 	}
// }

class SampleSettingTab extends PluginSettingTab {
	plugin: SmartDropPlugin;

	constructor(app: App, plugin: SmartDropPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Smart Drop Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
