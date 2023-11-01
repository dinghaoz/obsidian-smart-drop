import {
  App,
  Editor,
  htmlToMarkdown,
  MarkdownFileInfo,
  MarkdownView,
  Plugin,
  PluginSettingTab, requestUrl,
  Setting, TFile, Vault
} from 'obsidian'

import {getFileHash, normalizePath, promise, splitFileExtension} from "./utils";
import * as path from "path"
import isValidFilename from "valid-filename";
import {fileTypeFromBuffer} from "file-type";

declare module 'obsidian' {
  export interface Vault {
    getAssetFolder(file: TFile): string|null
    getLinkFromLocalPath(localPath: string, file: TFile): string
    writeBinary(buffer: ArrayBuffer, fileExtHint: string|null, folder: string): Promise<string|null>
  }
}
Vault.prototype.getAssetFolder = function (file: TFile) {
  const config = this.getConfig('attachmentFolderPath')
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

Vault.prototype.getLinkFromLocalPath = function (localPath: string, file: TFile) {
  const config = this.getConfig('newLinkFormat')
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


Vault.prototype.writeBinary = async function (buffer: ArrayBuffer, fileExtHint: string|null, folder: string): Promise<string|null> {
  let extension : string
  const fileType = await fileTypeFromBuffer(buffer)
  if (fileType) {
    extension = fileType.ext
  } else if (fileExtHint) {
    extension = fileExtHint
  } else {
    extension = "jpeg"
  }

  if (extension === 'apng') {
    extension = 'png' // obsidian doesn't recognize apng
  }

  const fileHash = await promise(() => getFileHash(buffer) )

  for (let i = 0; i < 100; i++) {
    let nameToWrite = fileHash
    if (i > 0) {
      nameToWrite = nameToWrite + `_${i}`
    }

    if (extension) {
      nameToWrite = nameToWrite + `.${extension}`
    }

    const localPath = path.join(folder, nameToWrite)
    if (!await this.adapter.exists(localPath)) {
      await this.createBinary(localPath, buffer)
      return localPath
    } else {
      const existing = await this.adapter.readBinary(localPath)

        const existingHash = await promise(() => getFileHash(existing) )
        console.log("existingHash", existingHash)
        console.log("md5 == existingHash", fileHash == existingHash)
        if (fileHash == existingHash) {
          return localPath
        }
    }
  }
  return null
}