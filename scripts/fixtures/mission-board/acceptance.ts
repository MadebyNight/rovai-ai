export async function runMissionAcceptance(): Promise<{ ok: true; cases: string[] }> {
  const qa = (window as any).missionQA
  const check = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
  const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const until = async (condition: () => unknown, message: string): Promise<void> => {
    for (let i = 0; i < 180; ++i) { await frames(); if (condition()) return }
    throw new Error(`${message}${qa.errors.length ? `\n${qa.errors.join('\n')}` : ''}`)
  }
  const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(el => el.getAttribute('aria-label') === label || el.textContent?.trim() === label)!
  const tab = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(el => el.textContent === label)
  const visiblePreview = () => document.querySelector<HTMLElement>('.file-preview-retained-host:not([hidden])')
  const fill = (element: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const cases: string[] = []
  await until(() => document.querySelector('button[title="使命板"]'), 'The Mission navigation must load')
  document.querySelector<HTMLButtonElement>('button[title="使命板"]')!.click()
  await until(() => document.querySelector('.mission-board-card'), 'The Mission board must load')
  const card = document.querySelector<HTMLElement>('.mission-board-card')!
  check(card.querySelector('.mission-card-meta > span')?.textContent === 'M-018', 'Mission card uses the stable display number')
  check(card.querySelectorAll('.mission-avatar-item').length === 4, 'All members appear on the card')
  check(card.querySelector('.mission-card-project')?.nextElementSibling?.classList.contains('mission-tags'), 'Tags follow the project')
  const lanes = [...document.querySelectorAll<HTMLElement>('.mission-column')]
  check(lanes.length === 4 && new Set(lanes.map(n => n.clientHeight)).size === 1, 'Four equal lanes')
  check(!document.querySelector('.mission-column header button'), 'No create control in status lanes')
  check(document.querySelector('.mission-page-header h1')?.textContent === '使命板', 'Board page title')
  check(parseFloat(getComputedStyle(document.querySelector('.mission-board-page')!).paddingTop) >= 30, 'Board title keeps overview-page top spacing')
  document.documentElement.style.zoom = '2'; await frames()
  check(card.clientWidth >= 170 && card.scrollWidth <= card.clientWidth + 1, 'Zoom keeps readable cards without overlapping content')
  const boardScroll = document.querySelector<HTMLElement>('.mission-board-scroll')!
  check(boardScroll.scrollWidth > boardScroll.clientWidth, 'Narrow board scrolls across lanes')
  document.documentElement.style.zoom = ''; await frames()
  cases.push('board has equal lanes, full roster, automatic tag colors and a stable header')

  button('状态筛选').click()
  await until(() => document.querySelector('.mission-unified-filter'), 'Status filter opens')
  check(!document.querySelector('.mission-filter-search'), 'Status filter has no search')
  check(!document.querySelector('.mission-unified-filter')?.textContent?.includes('全部'), 'No redundant all option')
  document.querySelector<HTMLButtonElement>('.mission-filter-options [role=checkbox]')!.click()
  await until(() => document.querySelector('.mission-filter-options [aria-checked=true]'), 'Status selection commits')
  check(getComputedStyle(document.querySelector('.mission-filter-options [aria-checked=true] .mission-filter-check')!).backgroundColor !== 'rgba(0, 0, 0, 0)', 'Selected checkbox is filled')
  document.querySelector<HTMLButtonElement>('.mission-filter-group button')!.click()
  button('清除筛选').click()
  button('项目筛选').click()
  await until(() => document.querySelector('input[aria-label="搜索项目"]'), 'Project filter has search')
  button('项目筛选').click()
  cases.push('filters share multi-select checkboxes; only project and tags have search')

  document.querySelector<HTMLButtonElement>('.mission-card-actions')!.click()
  const editAction = () => Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item => item.textContent?.trim() === '编辑使命')
  await until(editAction, 'Mission actions expose edit first')
  editAction()!.click()
  await until(() => document.querySelector('.mission-edit-dialog'), 'Edit dialog opens')
  check(document.querySelector('label[for$="-title"]')?.textContent === '使命标题', 'Edit fields have visible labels')
  check(button('保存').disabled, 'Unchanged Mission cannot be saved')
  const editing = qa.items[0]
  editing.title = '另一处刚更新的标题'; editing.detailsVersion += 1
  fill(document.querySelector<HTMLInputElement>('.mission-edit-dialog input')!, '第一次编辑')
  button('保存').click()
  await until(() => document.querySelector('.mission-edit-dialog [role=alert]')?.textContent?.includes('最新内容'), 'Conflict loads latest details')
  check((document.querySelector('.mission-edit-dialog input') as HTMLInputElement).value === '另一处刚更新的标题', 'Conflict replaces stale fields')
  fill(document.querySelector<HTMLInputElement>('.mission-edit-dialog input')!, '基于最新内容编辑')
  button('保存').click()
  await until(() => !document.querySelector('.mission-edit-dialog'), 'Fresh edit saves')
  check(editing.title === '基于最新内容编辑' && editing.detailsVersion === 3, 'Edit advances internal details version once')
  cases.push('edit is shared by card actions and reloads latest details after an optimistic conflict')

  const previewFits = () => {
    const anchor = document.querySelector('.mission-preview-body')?.getBoundingClientRect()
    const pane = visiblePreview()?.getBoundingClientRect()
    return anchor && pane && Math.abs(anchor.x - pane.x) < 2 && Math.abs(anchor.right - pane.right) < 2
  }
  document.querySelector<HTMLElement>('.mission-board-card')!.click()
  await until(() => document.querySelector('.mission-drawer #camp-message[contenteditable="true"]') && tab('活动'), 'Card opens the real Camp Composer and activity')
  await until(previewFits, 'Preview stays aligned after drawer entrance')
  const editor = document.getElementById('camp-message')!
  check(document.querySelector('.mission-session-header .context-breadcrumb')?.hasAttribute('hidden'), 'Drawer hides title')
  check(!document.querySelector('.mission-intro button:not(.mission-description-toggle)'), 'Mission intro is read-only')
  check(!document.querySelector('.camp-execution-drawer'), 'Opening running Mission does not open execution')
  editor.focus(); document.execCommand('insertText', false, '使命会话草稿')
  await frames()
  button('展开为完整会话').click()
  await until(() => document.querySelector('.mission-full'), 'Full conversation opens')
  check(document.getElementById('camp-message') === editor && editor.textContent?.includes('使命会话草稿'), 'Same Composer instance and draft after expanding')
  check(document.querySelector('.mission-session-header .context-project')?.textContent === 'rovai-ai', 'Full header shows project')
  button('折叠为使命抽屉').click()
  await until(() => document.querySelector('.mission-drawer'), 'Fold restores drawer')
  check(document.getElementById('camp-message') === editor, 'Folding retains the editor')
  cases.push('drawer/full headers and four Camp entries share one Composer without execution auto-open')

  button('活动').click()
  await until(() => !tab('活动') && !visiblePreview(), 'Second Activity click closes last tab and preview')
  button('活动').click()
  await until(() => document.querySelector('.mission-delivery-file') && visiblePreview(), 'Activity reopens')
  document.querySelector<HTMLButtonElement>('.mission-delivery-file .attachment-open')!.click()
  await until(() => visiblePreview()?.textContent?.includes('交互核对'), 'Delivery opens shared file viewer')
  const fileReader = visiblePreview()!.querySelector('.file-preview-content')!
  check(document.querySelectorAll('[role=tab]').length === 2, 'File and activity are siblings')
  button('活动').click()
  await until(() => tab('活动')?.getAttribute('aria-selected') === 'true', 'Toolbar activates existing activity')
  button('活动').click()
  await until(() => !tab('活动') && visiblePreview()?.textContent?.includes('交互核对'), 'Closing activity selects remaining file')
  check(fileReader.isConnected, 'File reader survives activity switch')
  document.querySelector<HTMLButtonElement>('.file-preview-tab-close')!.click()
  await until(() => !visiblePreview(), 'Closing last file hides preview')
  cases.push('activity toggle closes actual tab, falls back to retained file, and last close hides preview')

  button('活动').click()
  await until(() => visiblePreview() && tab('活动'), 'Activity is available again')
  const handle = document.querySelector<HTMLElement>('.mission-drawer-resize-handle')!
  handle.focus(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  await until(() => Math.round(document.querySelector('.mission-drawer')!.getBoundingClientRect().width) === 640, 'Keyboard minimum width')
  check(!!document.querySelector('.workspace-grid.file-preview-compact'), 'Narrow drawer uses compact preview')
  button('查看来源').click()
  await until(() => !visiblePreview(), 'Source navigation returns to compact conversation')
  check(document.getElementById('camp-message') === editor, 'Source link keeps Composer')
  handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  await until(() => document.querySelector('.mission-full'), 'Keyboard expansion')
  button('返回使命板').click()
  await until(() => !document.querySelector('.mission-workspace-host'), 'Return to board')
  cases.push('keyboard resize, compact preview and source navigation preserve conversation state')

  document.querySelector<HTMLButtonElement>('.mission-view-trigger')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  await until(() => document.querySelector('[role=menuitemradio]'), 'View menu')
  Array.from(document.querySelectorAll<HTMLElement>('[role=menuitemradio]')).find(n => n.textContent === '列表')!.click()
  await until(() => document.querySelectorAll('.mission-list-group').length === 4, 'List is grouped by status')
  document.querySelector<HTMLButtonElement>('.mission-group-heading')!.click()
  await until(() => document.querySelector('.mission-list-cards[hidden]'), 'List group folds')
  cases.push('list view uses independently collapsible status groups')

  const newEntry = button('新建使命'), entryBounds = newEntry.getBoundingClientRect()
  check(newEntry.contains(document.elementFromPoint(entryBounds.x + entryBounds.width / 2, entryBounds.y + entryBounds.height / 2)), 'Window drag strip cannot cover creation entry')
  newEntry.click()
  await until(() => document.querySelector('input[aria-label="使命标题"]'), 'Create dialog')
  fill(document.querySelector('input[aria-label="使命标题"]')!, '无描述使命')
  await frames()
  const create = button('新建')
  check(!button('保存使命') && create, 'One default create action')
  create.click()
  await until(() => qa.items.some((m: any) => m.title === '无描述使命'), 'Empty description creates Mission')
  await until(() => !document.querySelector('.new-camp-dialog'), 'Create dialog closes')
  check(!document.querySelector('.mission-workspace-host'), 'Create remains on board')
  const created = qa.items.find((m: any) => m.title === '无描述使命')
  check(created.description === '' && created.status === 'not_started', 'Default create does not start')
  check(!qa.calls.some((c: any) => c.method === 'missions.start' && c.p.command?.missionId === created.missionId), 'No start request on default create')
  check(qa.errors.length === 0, qa.errors.join('\n'))
  cases.push('optional description and default creation remain on board without starting')
  return { ok: true, cases }
}
