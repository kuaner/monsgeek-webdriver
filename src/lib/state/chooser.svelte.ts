// 弹出选择器（按键/功能/usage 搜索列表）的全局单例状态。

export interface ChooserItem {
  id: string
  label: string
  group?: string
}

type PickHandler = (id: string) => void

class ChooserStore {
  isOpen = $state(false)
  items: ChooserItem[] = $state([])
  currentId = $state('')
  search = $state('')
  position = $state({ top: 0, left: 0 })

  private anchorRect: DOMRect | null = null
  private handler: PickHandler | null = null

  open(anchor: HTMLElement, items: ChooserItem[], currentId: string, onPick: PickHandler): void {
    this.items = items
    this.currentId = currentId
    this.search = ''
    this.anchorRect = anchor.getBoundingClientRect()
    this.handler = onPick
    this.reposition()
    this.isOpen = true
  }

  private reposition(): void {
    const rect = this.anchorRect
    if (!rect) return
    const below = window.innerHeight - rect.bottom > 340
    const top = below ? rect.bottom + 6 : Math.max(8, rect.top - 336)
    const left = Math.min(rect.left, window.innerWidth - 316)
    this.position = { top, left }
  }

  pick(id: string): void {
    const handler = this.handler
    this.close()
    handler?.(id)
  }

  close(): void {
    this.isOpen = false
    this.handler = null
    this.items = []
    this.anchorRect = null
  }

  get filtered(): ChooserItem[] {
    const needle = this.search.trim().toLowerCase()
    if (!needle) return this.items
    return this.items.filter((item) => item.label.toLowerCase().includes(needle))
  }
}

export const chooser = new ChooserStore()
