import {
  App,
  Editor,
  htmlToMarkdown,
  MarkdownFileInfo,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting
} from 'obsidian';

import * as cheerio from 'cheerio'
// Remember to rename these classes and interfaces!
import hljs from 'highlight.js'

interface MyPluginSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: 'default'
}

const SUPPORTED_LANGUAGES = [
  "applescript",
  "xml",
  "bash",
  "c",
  "cmake",
  "cpp",
  "csharp",
  "dart",
  "ruby",
  "go",
  "java",
  "javascript",
  "json",
  "kotlin",
  "latex",
  "perl",
  "objectivec",
  "php",
  "python",
  "shell",
  "yaml",
  "swift",
  "typescript",
]

function prevent(evt: Event) {
  if (!evt.defaultPrevented) {
    evt.preventDefault()
  }
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
        this.onEditorDataTransfer(evt, evt.clipboardData, editor, info)
      }
    )

    this.app.workspace.on(
      "editor-drop",
      (evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
        console.log("editor-drop")
        this.onEditorDataTransfer(evt, evt.dataTransfer, editor, info)
      }
    )
  }


  private async onEditorDataTransfer(evt: Event, dataTransfer: DataTransfer|null, editor: Editor, _: MarkdownView | MarkdownFileInfo) {
    if (!dataTransfer) { return }


    const uriList = dataTransfer.getData("text/uri-list")
    const html = dataTransfer.getData("text/html")
    const plain = dataTransfer.getData("text/plain")


    if (html.length) {
      console.log("text/html", html)

      const $ = cheerio.load(html)

      $("img").each((_, img) => {
        console.log("src", $(img).attr("src"))
        console.log("style", $(img).attr("style"))
      })
      prevent(evt)
      editor.replaceSelection(htmlToMarkdown(html))
    } else if (uriList.length) {
      console.log("text/uri-list", uriList)

    } else {
      console.log("text/plain", plain)
      console.log("all langs:", hljs.listLanguages())
      if (plain.includes('\n') || plain.includes('\r')) {

        const languageRes = hljs.highlightAuto(plain, SUPPORTED_LANGUAGES)
        console.log("guessed language:", languageRes)

        if (languageRes.language && languageRes.relevance > 10) {
            prevent(evt)
            editor.replaceSelection(
              "```" + languageRes.language + "\n" +
              plain +
              (plain.endsWith("\n") ? "" : "\n") +
              "```\n"
            )
        }
      }
    }


    // const markdown = htmlToMarkdown(html)
    // console.log("markdown", markdown)
    //
    // editor.replaceSelection(markdown)
    //
    // const extractor = markdownLinkExtractor(markdown)
    // console.log("links", extractor.links)
    // console.log("anchor", extractor.anchors)
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
//   constructor(app: App) {
//     super(app);
//   }
//
//   onOpen() {
//     const {contentEl} = this;
//     contentEl.setText('Woah!');
//   }
//
//   onClose() {
//     const {contentEl} = this;
//     contentEl.empty();
//   }
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
