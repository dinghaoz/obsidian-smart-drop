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

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82  Safari/537.36';

async function downloadImage(url: string): Promise<ArrayBuffer|null> {

  const headers = {
    'method': 'GET',
    'User-Agent': USER_AGENT
  }
  console.log("download: ", url)
  try {
    const res = await requestUrl({ url: url, headers })
    console.log("download response: ", res)
    return res.arrayBuffer;
  }
  catch (e) {
    console.log("download failed: ", e)
    return null;
  }
}

function splitFileExtension(filename: string) {
  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex >= 0) {
    const basename = filename.slice(0, lastDotIndex);
    const extension = filename.slice(lastDotIndex + 1);
    if (extension.length > 5) {
      return { basename: filename, extension: null}
    } else {
      return { basename, extension };
    }
  } else {
    // If there's no dot in the filename, assume no extension.
    return { basename: filename, extension: null };
  }
}

export function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

export function md5Sig(contentData: ArrayBuffer) {
  try {
    var dec = new TextDecoder("utf-8");
    const arrMid = Math.round(contentData.byteLength / 2);
    const chunk = 15000;
    const signature = crypto.createHash('md5').update([
        contentData.slice(0, chunk),
        contentData.slice(arrMid, arrMid + chunk),
        contentData.slice(-chunk)
      ].map(x => dec.decode(x)).join()
    ).digest('hex')

    return signature + "_MD5";
  }
  catch (e) {
    return null;
  }

}


interface MyPluginSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: 'default'
}

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

  private getAssetFolder(file: TFile): string|null {
    const config = this.app.vault.getConfig('attachmentFolderPath')
    if (config === '/' ){
      return config
    } else if (config === './'){
      if (file.parent) {
        return normalizePath(file.parent.path)
      } else {
        return null
      }
    } else if (config.match (/\.\/.+/g) !== null) {
      if (file.parent) {
        return normalizePath(path.join(file.parent.path, config.replace('\.\/','')))
      } else {
        return null
      }
    } else{
      return normalizePath(config);
    }
  }

  private async handleImageSrc(imgSrc: string, assetFolder: string, editor: Editor, file: TFile) {
    const imgUrl = new URL(imgSrc)
    console.log("img protocol: ", imgUrl.protocol)
    if (imgUrl.protocol === "http:" || imgUrl.protocol === "https:") {
      await this.handleHttpImageSrc(imgSrc, assetFolder, editor, file)
    } else if (imgUrl.protocol === 'data:') {
      console.log("img path: ", imgUrl)
      const regex = /image\/(?<format>\w+);base64,(?<base64>.+)/g
      const match = imgUrl.pathname.match(regex)
      if (!match) {return}
      const [full, format, base64] = match
      const buffer = Buffer.from(base64, 'base64')

    } else if (imgUrl.protocol === 'file') {

    } else if (imgUrl.protocol === 'app') {

    }
  }

  private getLinkFromLocalPath(localPath: string, file: TFile): string {
    const config = this.app.vault.getConfig('newLinkFormat')
    console.log("newLinkFormat: ", config)
    if (config === "relative") {
      let parentPath = file.parent?.path
      if (parentPath) {
        parentPath = parentPath + path.sep
        if (localPath.search(parentPath) == 0) {
          return localPath.substring(parentPath.length)
        } else {
          return localPath
        }
      } else {
        return localPath
      }
    } else if (config === "absolute") {
      return localPath
    } else { // "shortest"
      const name = localPath.split(path.sep).pop()
      if (name) {
        return name
      } else {
        return localPath
      }
    }
  }

  private async handleHttpImageSrc(imgSrc: string, assetFolder: string, editor: Editor, file: TFile) {
    const imgBuffer = await downloadImage(imgSrc)
    console.log("downloaded img")
    if (!imgBuffer) {
      console.log("no buffer")
      return
    }

    const localPath = await this.writeBinary(imgBuffer, imgSrc, assetFolder)
    console.log("localPath: ", localPath)

    if (localPath) {
      const localLink = this.getLinkFromLocalPath(localPath, file)
      const usesMDLink = this.app.vault.getConfig("useMarkdownLinks")
      console.log("useMarkdownLinks: ", usesMDLink)

      const regex = /!\[(?<text>[^\]]*)]\((?<url>[^)]+)\)/g
      const doc = editor.getValue()

      console.log("doc: ", doc)
      let newDoc = doc
      let match
      while (match = regex.exec(doc)) {
        console.log("match: ", match)
        const [full, text, url] = match
        if (url === imgSrc) {
          if (usesMDLink) {
            newDoc = newDoc.replace(full, `![${text}](${encodeURI(localLink)})`)
          } else {
            newDoc = newDoc.replace(full, `![[${localLink}|${text}]]`)
          }
        }
      }

      if (newDoc != doc) {
        editor.setValue(newDoc)
      }
    }
  }

  private async writeBinary(buffer: ArrayBuffer, imgSrc: string, folder: string): Promise<string | null> {
    const imgUrl = new URL(imgSrc)
    const filename = imgUrl.pathname.split('/').pop()
    let md5: string|undefined|null = undefined

    console.log("filename: ", filename)
    let {basename, extension} = filename ? splitFileExtension(filename) : {basename: null, extension: null}
    console.log("basename: ", basename)
    console.log("extension: ", extension)

    if (!basename || !isValidFilename(basename) || basename.length > 128) {
      md5 = md5Sig(buffer)
      if (!md5) { return null }
      basename = md5
    }

    const fileType = await fileTypeFromBuffer(buffer)
    if (fileType) {
      extension = fileType.ext
    }

    if (!extension) {
      extension = "jpeg"
    }

    if (extension === 'apng') {
      extension = 'png' // obsidian doesn't recognize apng
    }

    for (let i = 0; i < 100; i++) {
      let nameToWrite = basename
      if (i > 0) {
        nameToWrite = nameToWrite + `_${i}`
      }

      if (extension) {
        nameToWrite = nameToWrite + `.${extension}`
      }

      const localPath = path.join(folder, nameToWrite)
      if (!await this.app.vault.adapter.exists(localPath)) {
        await this.app.vault.createBinary(localPath, buffer)
        return localPath
      } else {
        const existing = await this.app.vault.adapter.readBinary(localPath)
        if (md5 === undefined) {
          md5 = md5Sig(buffer)
          console.log("init md5", md5)
        }

        if (md5) {
          const existingMd5 = md5Sig(existing)
          console.log("existingMd5", existingMd5)
          console.log("md5 == existingMd5", md5 == existingMd5)
          if (md5 == existingMd5) {
            return localPath
          }
        }
      }
    }
    return null
  }

  private async onEditorDataTransfer(evt: Event, dataTransfer: DataTransfer|null, editor: Editor, viewOrFile: MarkdownView | MarkdownFileInfo) {
    if (!dataTransfer) { return }


    const uriList = dataTransfer.getData("text/uri-list")
    const html = dataTransfer.getData("text/html")
    const plain = dataTransfer.getData("text/plain")


    if (html.length) {
      console.log("text/html", html)

      const $ = cheerio.load(html)
      const file = viewOrFile.file
      if (!file) { return }

      const assetFolder = this.getAssetFolder(viewOrFile.file)
      if (!assetFolder) { return }

      console.log("ensure assetFolder: ", assetFolder)
      try { await this.app.vault.createFolder(assetFolder) } catch (e) {}

      let imgSrcList: string[] = []
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

    } else {
      console.log("text/plain", plain)
      if (plain.includes('\n') || plain.includes('\r')) {
        const langRes = detectLang(plain, { statistics: true })
        console.log("guessed language:", langRes)

        if (langRes.detected != 'Unknown') {
            prevent(evt)
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
