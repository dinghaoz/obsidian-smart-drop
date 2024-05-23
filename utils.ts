import * as crypto from "crypto"
import {requestUrl} from "obsidian";
import {fileTypeFromBuffer} from "file-type";
import { sep } from 'path';

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

const MDLINK_PATTERN = /!\[(?<title>[^\]]*)]\((?<url>[^)]+)\)/
const WIKI_PATTERN = /!\[\[(?<url>[^\]|]*).*?]]/

export function extractInternalLink(text: string) {
  let match
  while (match = MDLINK_PATTERN.exec(text)) {
    const [full, title, url] = match
    return {
      full: full,
      url: url
    }
  }

  while (match = WIKI_PATTERN.exec(text)) {
    const [full, url] = match
    return {
      full: full,
      url: url
    }
  }
  return null
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
    if (fileExtHint === 'svg' || fileExtHint === 'webp' || fileExtHint === 'gif') {
      return  {
        buffer: buffer,
        width: null,
        height: null,
        fileExtHint: fileExtHint
      }
    }
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
export function fileUriToPath(uri: string): string {
  if (
    uri.length <= 7 ||
    uri.substring(0, 7) !== 'file://'
  ) {
    throw new TypeError(
      'must pass in a file:// URI to convert to a file path'
    );
  }

  const rest = decodeURI(uri.substring(7));
  const firstSlash = rest.indexOf('/');
  let host = rest.substring(0, firstSlash);
  let path = rest.substring(firstSlash + 1);

  // 2.  Scheme Definition
  // As a special case, <host> can be the string "localhost" or the empty
  // string; this is interpreted as "the machine from which the URL is
  // being interpreted".
  if (host === 'localhost') {
    host = '';
  }

  if (host) {
    host = sep + sep + host;
  }

  // 3.2  Drives, drive letters, mount points, file system root
  // Drive letters are mapped into the top of a file URI in various ways,
  // depending on the implementation; some applications substitute
  // vertical bar ("|") for the colon after the drive letter, yielding
  // "file:///c|/tmp/test.txt".  In some cases, the colon is left
  // unchanged, as in "file:///c:/tmp/test.txt".  In other cases, the
  // colon is simply omitted, as in "file:///c/tmp/test.txt".
  path = path.replace(/^(.+)\|/, '$1:');

  // for Windows, we need to invert the path separators from what a URI uses
  if (sep === '\\') {
    path = path.replace(/\//g, '\\');
  }

  if (/^.+:/.test(path)) {
    // has Windows drive at beginning of path
  } else {
    // unix path…
    path = sep + path;
  }

  return host + path;
}
