import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inspectMaterials, searchMaterials } from './shared-chat-materials'

const directories: string[] = []

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'rovai-materials-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.allSettled(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('shared chat materials', () => {
  it('lists Markdown and TXT files recursively and reports skipped entries', async () => {
    const root = await fixture()
    await writeFile(path.join(root, '进展.md'), '# 项目进展\n\n10 月 16 日完成评审。\n', 'utf8')
    await mkdir(path.join(root, 'sub'))
    await writeFile(path.join(root, 'sub', 'notes.txt'), '会议记录', 'utf8')
    await writeFile(path.join(root, 'image.png'), 'not text', 'utf8')
    await writeFile(path.join(root, '.hidden.md'), 'hidden', 'utf8')

    const status = await inspectMaterials(root)
    expect(status.state).toBe('ready')
    expect(status.fileCount).toBe(2)
    expect(status.skipped).toBeGreaterThan(0)
    expect(status.message).toContain('2 个文件')
  })

  it('returns only relevant snippets with a business date and file source', async () => {
    const root = await fixture()
    await writeFile(
      path.join(root, '项目进展记录.md'),
      '# 项目进展记录\n\n10 月 16 日完成评审，下一步进入联调。\n\n## 其他\n\n食堂菜单更新。\n',
      'utf8'
    )
    await writeFile(path.join(root, '预算.txt'), '预算总额一百万。', 'utf8')

    const result = await searchMaterials(root, '项目进展 评审')
    expect(result.status.state).toBe('ready')
    expect(result.snippets.length).toBeGreaterThan(0)
    expect(result.snippets[0].source).toBe('项目进展记录')
    expect(result.snippets[0].text).toContain('评审')
    expect(result.snippets[0].date).toBe('10月16日')
    expect(result.snippets[0].text).toContain('下一步进入联调')
  })

  it('re-reads the folder so updates and deletions apply immediately', async () => {
    const root = await fixture()
    const file = path.join(root, '状态.md')
    await writeFile(file, '当前状态：设计阶段。', 'utf8')
    expect((await searchMaterials(root, '状态')).snippets[0].text).toContain('设计阶段')

    await writeFile(file, '当前状态：已上线。', 'utf8')
    expect((await searchMaterials(root, '状态')).snippets[0].text).toContain('已上线')

    await unlink(file)
    const afterDelete = await searchMaterials(root, '状态')
    expect(afterDelete.snippets).toEqual([])
    expect(afterDelete.status.state).toBe('empty')
  })

  it('reports an unavailable folder without throwing', async () => {
    const status = await inspectMaterials(path.join(tmpdir(), 'rovai-missing-' + Date.now()))
    expect(status.state).toBe('unavailable')
    expect((await searchMaterials(null, '任何')).snippets).toEqual([])
  })

  it('rejects invalid UTF-8 instead of answering from mojibake', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'binary.md'), Buffer.from([0xff, 0xfe, 0x00, 0x41]))
    const result = await searchMaterials(root, 'A')
    expect(result.snippets).toEqual([])
  })
})
