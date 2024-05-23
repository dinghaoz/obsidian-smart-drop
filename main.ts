import {
  App,
  Editor,
  htmlToMarkdown,
  MarkdownFileInfo,
  MarkdownView, Menu, Notice,
  Plugin,
  PluginSettingTab, requestUrl,
  Setting, TFile, Vault
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
  preventEvent,
  replaceImgSrc,
  convertToWebp,
  tryConvertToWebp,
  getLinkText,
  getImageLinkWidth,
  extractInternalLink,
  fileUriToPath
} from './utils'
import {EasyWorker} from "./easy-worker";

import * as fs from "fs";
import getPageTitle from "./scraper";

interface MyPluginSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: 'default'
}

function createBlockHash(): string {
  let result = "";
  var characters = "abcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < 4; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
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


    this.registerEvent(this.app.workspace.on(
      "editor-paste",
      (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
        console.log("editor-past")
        this.onEditorDataTransfer(evt, evt.clipboardData, editor, info)
      }
    ))

    this.registerEvent(this.app.workspace.on(
      "editor-drop",
      (evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
        console.log("editor-drop")
        this.onEditorDataTransfer(evt, evt.dataTransfer, editor, info)
      }
    ))


    this.registerEvent(this.app.workspace.on(
      "editor-menu",
      (menu: Menu, editor: Editor, viewOrFile: MarkdownView | MarkdownFileInfo) => {
        const selection = editor.getSelection()
        console.log("selection", selection)
        const extracted = extractInternalLink(selection)
        console.log("extracted", extracted)
        if (extracted && selection.trim() === extracted.full) {
          const ext = splitFileExtension(extracted.url).extension
          if (ext && ['png', 'jpg', 'jpeg'].includes(ext.toLowerCase())) {
            menu.addItem(item => {
              item.setTitle("to webp").onClick(evt => {
                this.convertSelectedToWebP(extracted.url, editor, viewOrFile).catch(e => new Notice(e.toString()))
              })
            })
          }
        }
      }
    ))
  }

  private async convertSelectedToWebP(localLink: string, editor: Editor, viewOrFile: MarkdownView | MarkdownFileInfo) {
    const name = localLink.split(path.sep).pop()
    const attachedFiles = this.app.vault.getFiles().filter(f => f.name === name || encodeURI(f.name) === name)

    if (attachedFiles.length > 0) {
      attachedFiles.sort((a, b) => Math.abs(a.path.length - localLink.length) - Math.abs(b.path.length - localLink.length))
      const attached = attachedFiles[0]
      console.log("attached", attached)
      const noteFile = viewOrFile.file
      if (!noteFile) { return }

      const assetFolder = this.app.vault.getAssetFolder(viewOrFile.file)
      if (!assetFolder) { return }


      const buffer = await this.app.vault.adapter.readBinary(attached.path)
      const linkText = await this.tryConvertImageFileToWebP(buffer, attached.extension, assetFolder, noteFile, null)
      if (linkText) {
        editor.replaceSelection(linkText)
      }

    } else {
      throw Error("No file found!")
    }
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
      const usesMDLink = (this.app.vault as any).getConfig("useMarkdownLinks") ?? false
      console.log("usesMDLink", usesMDLink)

      const newDoc = await this.worker.run(replaceImgSrc, editor.getValue(), imgSrc, usesMDLink, localLink, getImageLinkWidth(converted.width, 400))
      if (newDoc) {
        editor.setValue(newDoc)
      }
    }
  }

  async tryConvertImageFileToWebP(imgFileBuffer: ArrayBuffer, fileExtHint: string|null, assetFolder: string, noteFile: TFile, targetWidth: number|null): Promise<string|null> {
    const converted = await tryConvertToWebp(imgFileBuffer, fileExtHint)
    const localPath = await this.app.vault.writeBinary(converted.buffer, converted.fileExtHint, assetFolder, b => this.worker.run(getFileHash, b))
    if (localPath) {
      const localLink = this.app.vault.getLinkFromLocalPath(localPath, noteFile)
      const usesMDLink = (this.app.vault as any).getConfig("useMarkdownLinks") ?? false
      return getLinkText(usesMDLink, localLink, "", targetWidth ? getImageLinkWidth(converted.width, targetWidth): null)
    } else {
      return null
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
      const filePathList = uriList.split(/\r|\n/)
        .filter(l => !l.startsWith("#") && l.length>0)
        .map(uri => fileUriToPath(uri))
        .filter(p => {
          const ext = splitFileExtension(p).extension?.toLowerCase()
          return ext && ['png', 'jpg', 'jpeg', 'gif', 'webp']
        })

      if (filePathList.length) {
        evt.preventDefault()

        const contents: string[] = []

        for (const filePath of filePathList) {
          const buffer = await fs.promises.readFile(filePath)
          const type = await fileTypeFromBuffer(buffer)
          if (type && type.mime.split('/')[0] === 'image') {

            const linkText = await this.tryConvertImageFileToWebP(buffer, type.ext, assetFolder, file, 400)
            if (linkText) {
              contents.push(linkText + '\n')
            }
          }
        }
        editor.replaceSelection(contents.join(''))
      }
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
          const linkText = await this.tryConvertImageFileToWebP(await imgFile.arrayBuffer(), splitFileExtension(imgFile.name).extension, assetFolder, file, 400)
          if (linkText) {
            contents.push(linkText + '\n')
          }
        }
        editor.replaceSelection(contents.join(''))
      }
    } else {
      console.log("text/plain", plain)
      if (plain.includes('```')) return

      if ((plain.includes('\n') || plain.includes('\r'))) {
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
      } else {
        try {
          const url = new URL(plain)
          if (url && (url.host.includes('youtube') || url.host.includes('bilibili'))) {
            preventEvent(evt)

            const hash = createBlockHash()
            const titlePlaceholder = `Fetching Title...(${hash})`

            let content = ""
            content += [
              "```video-note",
              `title: ${titlePlaceholder}`,
              `url: ${url}`,
              "```"
            ].join('\n') + '\n'

            editor.replaceSelection(content)

            getPageTitle(plain).then(t => {
              let title = t ?? "Failed"
              title = title.replace(':', ' ')
              title = title.split("|").first() ?? title

              const savedCursor = editor.getCursor()
              editor.setValue(editor.getValue().replace(titlePlaceholder, title))

              editor.setCursor(savedCursor)
            })
          }
        } catch (e) {

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
