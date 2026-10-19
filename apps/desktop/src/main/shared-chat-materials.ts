import { promises as fs } from 'node:fs'
import path from 'node:path'

export const MATERIALS_LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxFiles: 1000,
  maxSnippetBytes: 24 * 1024
} as const

export type MaterialsStatus = {
  state: 'unavailable' | 'empty' | 'ready'
  fileCount: number
  skipped: number
  message: string
}

export type MaterialSnippet = {
  source: string
  date: string | null
  text: string
}

export type MaterialsSearch = {
  status: MaterialsStatus
  snippets: MaterialSnippet[]
  truncated: boolean
}

const SUPPORTED = new Set(['.md', '.txt'])
const CHUNK_CHARS = 600
const MAX_CHUNKS_PER_FILE = 40

function sourceName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

/** Business date written in the content; file mtime is never used as a date. */
function businessDate(text: string): string | null {
  const iso = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (iso) {
    return iso[1] + '-' + iso[2].padStart(2, '0') + '-' + iso[3].padStart(2, '0')
  }
  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  return monthDay ? monthDay[1] + '月' + monthDay[2] + '日' : null
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const chunks: string[] = []
  let current = ''
  for (const paragraph of normalized.split(/\n{2,}/)) {
    if (paragraph.length > CHUNK_CHARS) {
      if (current.trim()) chunks.push(current.trim())
      current = ''
      for (let index = 0; index < paragraph.length; index += CHUNK_CHARS) {
        chunks.push(paragraph.slice(index, index + CHUNK_CHARS).trim())
      }
      continue
    }
    if (current.length + paragraph.length + 2 > CHUNK_CHARS && current.trim()) {
      chunks.push(current.trim())
      current = ''
    }
    current += (current ? '\n\n' : '') + paragraph
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(Boolean).slice(0, MAX_CHUNKS_PER_FILE)
}

export function queryTokens(query: string): string[] {
  const tokens = new Set<string>()
  for (const word of query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []) tokens.add(word)
  const cjk = query.replace(/[^\u4e00-\u9fff]/g, '')
  for (let index = 0; index + 2 <= cjk.length; index += 1) {
    tokens.add(cjk.slice(index, index + 2))
  }
  return [...tokens]
}

function scoreChunk(chunk: string, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const lower = chunk.toLowerCase()
  let score = 0
  for (const token of tokens) {
    let from = 0
    while (true) {
      const at = lower.indexOf(token, from)
      if (at < 0) break
      score += token.length >= 4 ? 3 : token.length === 2 ? 1 : 2
      from = at + token.length
    }
  }
  return score
}

type ListedFile = { path: string; name: string }

async function listSupportedFiles(root: string): Promise<{ files: ListedFile[]; skipped: number }> {
  const files: ListedFile[] = []
  let skipped = 0
  const queue = [root]
  while (queue.length > 0 && files.length < MATERIALS_LIMITS.maxFiles) {
    const directory = queue.shift()!
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      skipped += 1
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || files.length >= MATERIALS_LIMITS.maxFiles) {
        skipped += 1
        continue
      }
      const entryPath = path.join(directory, entry.name)
      let stats
      try {
        stats = await fs.lstat(entryPath)
      } catch {
        skipped += 1
        continue
      }
      // Never follow symlinks or Windows junctions outside the shared folder.
      if (stats.isSymbolicLink()) {
        skipped += 1
        continue
      }
      if (stats.isDirectory()) {
        queue.push(entryPath)
        continue
      }
      if (!stats.isFile()) {
        skipped += 1
        continue
      }
      if (!SUPPORTED.has(path.extname(entry.name).toLowerCase())) {
        skipped += 1
        continue
      }
      if (stats.size > MATERIALS_LIMITS.maxFileBytes) {
        skipped += 1
        continue
      }
      files.push({ path: entryPath, name: entry.name })
    }
  }
  return { files, skipped }
}

async function readSupported(filePath: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(filePath)
    if (buffer.byteLength > MATERIALS_LIMITS.maxFileBytes) return null
    const text = buffer.toString('utf8')
    // Reject invalid UTF-8 instead of answering from mojibake.
    if (text.includes('\uFFFD')) return null
    return text
  } catch {
    return null
  }
}

export async function inspectMaterials(directory: string | null): Promise<MaterialsStatus> {
  if (!directory) {
    return { state: 'unavailable', fileCount: 0, skipped: 0, message: '未绑定共享资料文件夹' }
  }
  const resolved = path.resolve(directory)
  try {
    const stats = await fs.lstat(resolved)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return { state: 'unavailable', fileCount: 0, skipped: 0, message: '资料文件夹不可用' }
    }
  } catch {
    return { state: 'unavailable', fileCount: 0, skipped: 0, message: '资料文件夹不可用' }
  }
  const { files, skipped } = await listSupportedFiles(resolved)
  if (files.length === 0) {
    return { state: 'empty', fileCount: 0, skipped, message: '没有可读取的 Markdown 或 TXT 文件' }
  }
  const message = skipped > 0
    ? '共 ' + files.length + ' 个文件可用，已跳过 ' + skipped + ' 个不支持或无法读取的条目'
    : '共 ' + files.length + ' 个文件可用'
  return { state: 'ready', fileCount: files.length, skipped, message }
}

/** Every call re-reads the folder, so add/update/delete takes effect immediately. */
export async function searchMaterials(
  directory: string | null,
  query: string,
  budgetBytes: number = MATERIALS_LIMITS.maxSnippetBytes
): Promise<MaterialsSearch> {
  const status = await inspectMaterials(directory)
  if (status.state !== 'ready' || !directory) {
    return { status, snippets: [], truncated: false }
  }
  const root = path.resolve(directory)
  const { files } = await listSupportedFiles(root)
  const tokens = queryTokens(query)
  const ranked: Array<MaterialSnippet & { score: number }> = []
  for (const file of files) {
    const text = await readSupported(file.path)
    if (text === null) continue
    const source = sourceName(file.path)
    for (const chunk of chunkText(text)) {
      const score = tokens.length > 0 ? scoreChunk(chunk, tokens) : 1
      if (score <= 0) continue
      ranked.push({ source, date: businessDate(chunk), text: chunk, score })
    }
  }
  ranked.sort((left, right) => right.score - left.score)
  const snippets: MaterialSnippet[] = []
  let bytes = 0
  let truncated = false
  for (const snippet of ranked) {
    const size = Buffer.byteLength(snippet.text)
    if (bytes + size > budgetBytes) {
      truncated = true
      continue
    }
    bytes += size
    snippets.push({ source: snippet.source, date: snippet.date, text: snippet.text })
    if (snippets.length >= 20) {
      truncated = true
      break
    }
  }
  return { status, snippets, truncated }
}
