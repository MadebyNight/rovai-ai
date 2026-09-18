import { describe, expect, it } from 'vitest'
import type { MissionChangedFile } from '@contracts'
import { missionFileTree } from './MissionDelivery'

function changedFile(id: string, path: string): MissionChangedFile {
  return {
    id,
    path,
    oldPath: null,
    kind: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    oldMode: '100644',
    newMode: '100644'
  }
}

function treeShape(nodes: ReturnType<typeof missionFileTree>): unknown[] {
  return nodes.map(node => node.kind === 'file'
    ? { kind: node.kind, name: node.name, path: node.path, id: node.file.id }
    : { kind: node.kind, name: node.name, path: node.path, count: node.count, children: treeShape(node.children) })
}

describe('Mission cumulative file tree', () => {
  it('sorts directories before files, compresses single-directory chains and counts descendants', () => {
    const tree = missionFileTree([
      changedFile('readme', 'README.md'),
      changedFile('worker', 'src/runtime/worker.ts'),
      changedFile('cache', 'src/runtime/cache.ts'),
      changedFile('app', 'src/ui/App.tsx'),
      changedFile('logo', 'assets/icons/logo.png')
    ])

    expect(treeShape(tree)).toEqual([
      {
        kind: 'directory',
        name: 'assets/icons',
        path: 'assets/icons',
        count: 1,
        children: [
          { kind: 'file', name: 'logo.png', path: 'assets/icons/logo.png', id: 'logo' }
        ]
      },
      {
        kind: 'directory',
        name: 'src',
        path: 'src',
        count: 3,
        children: [
          {
            kind: 'directory',
            name: 'runtime',
            path: 'src/runtime',
            count: 2,
            children: [
              { kind: 'file', name: 'cache.ts', path: 'src/runtime/cache.ts', id: 'cache' },
              { kind: 'file', name: 'worker.ts', path: 'src/runtime/worker.ts', id: 'worker' }
            ]
          },
          {
            kind: 'directory',
            name: 'ui',
            path: 'src/ui',
            count: 1,
            children: [
              { kind: 'file', name: 'App.tsx', path: 'src/ui/App.tsx', id: 'app' }
            ]
          }
        ]
      },
      { kind: 'file', name: 'README.md', path: 'README.md', id: 'readme' }
    ])
  })
})
