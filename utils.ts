import * as crypto from "crypto"
import {requestUrl} from "obsidian";
import {fileTypeFromBuffer} from "file-type";


export function getFileHash(buffer: ArrayBuffer): string {
  return crypto.createHash('md5').update(Buffer.from(buffer)).digest('hex')
}

export function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

export function splitFileExtension(filename: string) {
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
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82  Safari/537.36';

export async function downloadImage(url: string): Promise<ArrayBuffer|null> {

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

export function preventEvent(evt: Event) {
  if (!evt.defaultPrevented) {
    evt.preventDefault()
  }
}

export function getLinkText(usesMDLink: boolean, localLink: string, title: string, width: number|null) {
  const contents: string[] = []
  if (title)
    contents.push(title)
  if (width)
    contents.push(width.toString())

  if (usesMDLink) {
    return `![${contents.join('|')}](${encodeURI(localLink)})`
  } else {
    contents.unshift(localLink)
    return `![[${contents.join('|')}]]`
  }
}

export function getImageLinkWidth(imgWidth: number|null, target: number) {
  if (imgWidth && imgWidth > target) {
    return target
  } else {
    return null
  }
}

export function replaceImgSrc(doc: string, imgSrc: string, usesMDLink: boolean, localLink: string, width: number|null): string | null {

  function getLinkText(usesMDLink: boolean, localLink: string, title: string, width: number|null) {
    const contents: string[] = []
    if (title)
      contents.push(title)
    if (width)
      contents.push(width.toString())

    if (usesMDLink) {
      return `![${contents.join('|')}](${encodeURI(localLink)})`
    } else {
      contents.unshift(localLink)
      return `![[${contents.join('|')}]]`
    }
  }

  console.log("doc: ", doc)
  console.log("imgSrc: ", imgSrc)
  console.log("localLink: ", localLink)
  console.log("useMarkdownLinks: ", usesMDLink)
  const regex = /!\[(?<title>[^\]]*)]\((?<url>[^)]+)\)/g

  console.log("doc: ", doc)
  let newDoc = doc
  let match
  while (match = regex.exec(doc)) {
    console.log("match: ", match)
    const [full, title, url] = match
    if (url === imgSrc) {
      newDoc = newDoc.replace(full, getLinkText(usesMDLink, localLink, title, width))
    }
  }

  if (newDoc != doc) {
    return newDoc
  } else {
    return null
  }
}

export async function convertToWebp(buffer: ArrayBuffer) {
  const fileType = await fileTypeFromBuffer(buffer)
  return new Promise<{buffer: ArrayBuffer, width: number, height: number}>((resolve, reject) => {
    if (!fileType) {
      reject(Error("not image buffer"))
      return
    }

    const blob = new Blob( [ buffer ], { type: fileType.mime } )
    const urlCreator = window.URL || window.webkitURL
    const imageUrl = urlCreator.createObjectURL(blob)

    const imageElement = new Image()

    imageElement.onload = () => {

      const canvas = document.createElement('canvas')
      canvas.width = imageElement.naturalWidth
      canvas.height = imageElement.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) {
        reject(Error("Failed to get canvas context"))
        return
      }

      context.drawImage(imageElement, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob.arrayBuffer().then(buffer => ({buffer: buffer, width: canvas.width, height: canvas.height})))
        } else {
          reject(Error("Failed to get blob from canvas"))
        }

      }, 'image/webp');

    };

    imageElement.src = imageUrl
  })
}


export async function tryConvertToWebp(buffer: ArrayBuffer, fileExtHint: string|null) {
  try {
    const converted = await convertToWebp(buffer)
    return {
      ...converted,
      fileExtHint: "webp"
    }
  } catch (e) {
    console.error("WebP", e)
    return  {
      buffer: buffer,
      width: null,
      height: null,
      fileExtHint: fileExtHint
    }
  }
}