import * as crypto from "crypto"
import {requestUrl} from "obsidian";


export async function promise<T>(action: ()=>T): Promise<T> {
  return new Promise<T>(resolve => {
    resolve(action())
  })
}
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

export function replaceImgSrc(doc: string, imgSrc: string, localLink: string, usesMDLink: boolean): string | null {
  console.log("useMarkdownLinks: ", usesMDLink)
  const regex = /!\[(?<text>[^\]]*)]\((?<url>[^)]+)\)/g

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
    return newDoc
  } else {
    return null
  }
}