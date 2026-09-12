import { MEMBER_AVATAR_LIMITS, type MemberAvatarRendition, type MemberAvatarsApi } from '@contracts'
import { validateDecodedMemberAvatarDimensions } from '../../desktop/src/renderer/src/member-avatar-image'
import type { ConsoleClient } from './client'

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}

export function browserMemberAvatars(transport: ConsoleClient): MemberAvatarsApi {
  return {
    selectSource: async () => {
      const file = await new Promise<File | null>(resolve => {
        const input = document.createElement('input')
        input.type = 'file'; input.accept = 'image/png,image/jpeg'
        input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove() }, { once: true })
        input.addEventListener('cancel', () => { resolve(null); input.remove() }, { once: true })
        input.hidden = true; document.body.append(input); input.click()
      })
      if (!file) return null
      if (file.size > MEMBER_AVATAR_LIMITS.selectedFileBytes) throw new Error('角色图片不能超过 10 MiB')
      if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('请选择 PNG 或 JPEG 图片')
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      try {
        validateDecodedMemberAvatarDimensions(bitmap.width, bitmap.height)
        return { displayName: file.name, mediaType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), inspectedWidth: bitmap.width, inspectedHeight: bitmap.height, byteLength: file.size }
      } finally { bitmap.close() }
    },
    save: input => transport.avatar('save', {
      sourceBase64: base64(input.sourcePng), iconBase64: base64(input.iconPng),
      sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, crop: input.crop
    }),
    read: async (avatarRef, rendition) => {
      const image = await transport.avatar<Omit<MemberAvatarRendition, 'bytes'> & { base64: string } | null>('read', { avatarRef, rendition })
      return image ? { ...image, bytes: Uint8Array.from(atob(image.base64), char => char.charCodeAt(0)) } : null
    }
  }
}
