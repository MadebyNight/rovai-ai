export async function runMissionAcceptance(): Promise<{ ok: true; cases: string[] }> {
  const qa = (window as any).missionQA
  const check = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
  const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const until = async (condition: () => unknown, message: string): Promise<void> => {
    for (let i = 0; i < 120; ++i) { await frames(); if (condition()) return }
    throw new Error(message)
  }
  const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(el => el.getAttribute('aria-label') === label || el.textContent?.trim() === label)!
  const tab = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(el => el.textContent === label)!
  const cases: string[] = []
  await until(() => document.querySelector('button[title="使命"]'), 'The Mission navigation must load')
  document.querySelector<HTMLButtonElement>('button[title="使命"]')!.click()
  await until(() => document.querySelector('.mission-board-card'), 'The Mission board must load')
  const card = document.querySelector<HTMLElement>('.mission-board-card')!
  check(card.querySelectorAll('.mission-avatar-item').length === 4, 'All members must appear on the card')
  check(card.querySelector('.mission-card-project')?.nextElementSibling?.classList.contains('mission-tags'), 'Tags follow the project')
  card.click()
  await until(() => document.querySelector('.mission-drawer #camp-message[contenteditable="true"]'), 'The whole card must open the real Camp Composer')
  const editor = document.getElementById('camp-message')!
  check(editor, 'Mission drawer owns the production editor')
  editor.focus(); document.execCommand('insertText', false, '使命会话草稿')
  await frames()
  button('打开完整使命会话').click()
  await until(() => document.querySelector('.mission-conversation'), 'Full conversation must open')
  check(document.getElementById('camp-message') === editor && editor.textContent?.includes('使命会话草稿'), 'Presentation switch must retain the exact Composer instance and text')
  cases.push('whole card navigation and drawer/full presentation preserve the Camp Composer')

  tab('交付').click()
  await until(() => document.querySelector('.mission-delivery-file'), 'Actual delivery projection must load')
  check(document.getElementById('camp-message') === editor, 'Delivery keeps the Composer mounted')
  document.querySelector<HTMLButtonElement>('.mission-delivery-file .attachment-open')!.click()
  await until(() => document.querySelector('section.file-preview-pane')?.textContent?.includes('交互核对'), 'Delivery must open the shared file viewer')
  const preview = document.querySelector<HTMLElement>('section.file-preview-pane')!
  button('查看来源').click()
  await until(() => tab('会话').getAttribute('aria-selected') === 'true', 'Source link must activate the conversation')
  check(document.getElementById('camp-message') === editor && document.querySelector('section.file-preview-pane') === preview, 'Source navigation must retain both editors and preview')
  cases.push('delivery file and source navigation share the persistent file preview')

  button('使命详情').click()
  await until(() => document.querySelector('.mission-drawer'), 'Drawer must reopen')
  await frames()
  const rect = preview.getBoundingClientRect()
  check(preview.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), 'The retained file viewer must paint above the drawer')
  button('收起文件预览').click()
  tab('交付').click()
  await until(() => document.querySelector('.mission-source-link'), 'Collapsing compact preview restores delivery')
  button('查看来源').click()
  check(document.getElementById('camp-message') === editor, 'Compact preview/source actions cannot replace the Composer')
  check(qa.errors.length === 0, qa.errors.join('\n'))
  cases.push('compact drawer preview is visible and collapses back to the same Mission')
  return { ok: true, cases }
}
