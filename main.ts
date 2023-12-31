import {
  App,
  Editor,
  htmlToMarkdown,
  MarkdownFileInfo,
  MarkdownView,
  Plugin,
  PluginSettingTab, requestUrl,
  Setting, TFile
} from 'obsidian';

import * as cheerio from 'cheerio'
import * as path from "path"
var detectLang = require('lang-detector')
const crypto = require('crypto')
import isValidFilename from 'valid-filename'
import {fileTypeFromBuffer} from 'file-type'
import "./obsidian-ext"

import {
  getFileHash,
  downloadImage,
  splitFileExtension,
  preventEvent, replaceImgSrc, convertToWebp, tryConvertToWebp, getLinkText, getImageLinkWidth
} from './utils'
import * as buffer from "buffer";
import {EasyWorker} from "./easy-worker";

interface MyPluginSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: 'default'
}


export default class SmartDropPlugin extends Plugin {
  settings: MyPluginSettings;

  worker: EasyWorker

  async onload() {
    await this.loadSettings();

    this.worker = new EasyWorker([`const crypto = require("crypto");`])

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

  private async handleImageSrc(imgSrc: string, assetFolder: string, editor: Editor, file: TFile) {
    const imgUrl = new URL(imgSrc)
    console.log("img protocol: ", imgUrl.protocol)
    if (imgUrl.protocol === "http:" || imgUrl.protocol === "https:") {
      await this.handleHttpImageSrc(imgSrc, assetFolder, editor, file)
    } else if (imgUrl.protocol === 'data:') {
      console.log("img path: ", imgUrl)
      await this.handleDataImageSrc(imgSrc, assetFolder, editor, file)
    } else if (imgUrl.protocol === 'file') {

    } else if (imgUrl.protocol === 'app') {

    }
  }

  private async handleHttpImageSrc(imgSrc: string, assetFolder: string, editor: Editor, file: TFile) {
    const imgBuffer = await downloadImage(imgSrc)
    console.log("downloaded img")
    if (!imgBuffer) {
      console.log("no buffer")
      return
    }

    const imgUrl = new URL(imgSrc)
    const filename = imgUrl.pathname.split('/').pop()
    let {extension} = filename ? splitFileExtension(filename) : {extension: null}
    await this.convertLinks(imgBuffer, imgSrc, extension, assetFolder, editor, file)
  }

  private async handleDataImageSrc(imgSrc: string, assetFolder: string, editor: Editor, file: TFile) {
    // image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAk1BMVEX//
    const regex = /image\/(?<format>\w+);base64,(?<base64>.+)/g
    const match = regex.exec(new URL(imgSrc).pathname)
    if (!match) {return}
    const [full, format, base64] = match

    const imgBuffer = Buffer.from(base64, 'base64')

    await this.convertLinks(imgBuffer, imgSrc, format, assetFolder, editor, file)
  }

  private async convertLinks(buffer: ArrayBuffer, imgSrc:string, fileExtHint: string|null, folder: string, editor: Editor, file: TFile) {
    console.log("convertLinks", imgSrc)
    const converted = await tryConvertToWebp(buffer, fileExtHint)
    const localPath = await this.app.vault.writeBinary(converted.buffer, converted.fileExtHint, folder, b => this.worker.run(getFileHash, b))
    console.log("localPath: ", localPath)

    if (localPath) {
      const localLink = this.app.vault.getLinkFromLocalPath(localPath, file)
      const usesMDLink = this.app.vault.getConfig("useMarkdownLinks") ?? false
      console.log("usesMDLink", usesMDLink)

      const newDoc = await this.worker.run(replaceImgSrc, editor.getValue(), imgSrc, usesMDLink, localLink, getImageLinkWidth(converted.width, 400))
      if (newDoc) {
        editor.setValue(newDoc)
      }
    }
  }


  private async onEditorDataTransfer(evt: Event, dataTransfer: DataTransfer|null, editor: Editor, viewOrFile: MarkdownView | MarkdownFileInfo) {
    if (!dataTransfer) { return }

    console.log("clipboard: ", dataTransfer.types)

    const uriList = dataTransfer.getData("text/uri-list")
    const html = dataTransfer.getData("text/html")
    const plain = dataTransfer.getData("text/plain")
    const files = dataTransfer.files

    const file = viewOrFile.file
    if (!file) { return }

    const assetFolder = this.app.vault.getAssetFolder(viewOrFile.file)
    if (!assetFolder) { return }

    if (html.length) {
      console.log("text/html", html)

      const $ = cheerio.load(html)

      console.log("ensure assetFolder: ", assetFolder)
      try { await this.app.vault.createFolder(assetFolder) } catch (e) {}

      const imgSrcList: string[] = []
      $("img").each((_, img) => {
        const imgSrc = $(img).attr("src")
        if (imgSrc && !imgSrcList.contains(imgSrc)) {
          imgSrcList.push(imgSrc)
        }
      })

      if (imgSrcList.length == 0) { return }
      imgSrcList.forEach((imgSrc) => {
        this.handleImageSrc(imgSrc, assetFolder, editor, file).catch((reason) => {
          console.log("failed to handle %s", imgSrc, reason)
        })
      })
    } else if (uriList.length) {
      console.log("text/uri-list", uriList)

    } else if (files.length) {

      console.log("Files", files)
      const imgFileList: File[] = []
      for (let i=0; i<files.length; ++i) {
        const file = files[i]
        if (file.type.split('/')[0] === 'image') {
          imgFileList.push(file)
        }
      }

      if (imgFileList.length) {
        evt.preventDefault()
        const contents: string[] = []
        for (const imgFile of imgFileList) {
          const converted = await tryConvertToWebp(await imgFile.arrayBuffer(), splitFileExtension(imgFile.name).extension)
          const localPath = await this.app.vault.writeBinary(converted.buffer, converted.fileExtHint, assetFolder, b => this.worker.run(getFileHash, b))
          if (localPath) {
            const localLink = this.app.vault.getLinkFromLocalPath(localPath, file)
            const usesMDLink = this.app.vault.getConfig("useMarkdownLinks") ?? false
            const linkText = getLinkText(usesMDLink, localLink, "", getImageLinkWidth(converted.width, 400))
            contents.push(linkText + '\n')
          }
        }
        editor.replaceSelection(contents.join(''))
      }
    } else {
      console.log("text/plain", plain)
      if ((plain.includes('\n') || plain.includes('\r')) && !plain.includes('```')) {
        const langRes = detectLang(plain, { statistics: true })
        console.log("guessed language:", langRes)

        if (langRes.detected != 'Unknown') {
            preventEvent(evt)
            editor.replaceSelection(
              "```" + langRes.detected + "\n" +
              plain +
              (plain.endsWith("\n") ? "" : "\n") +
              "```\n"
            )
        }
      }
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
