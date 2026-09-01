import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const HEIGHT_TIP = [
  '高度0：无遮蔽，爆炸减伤0%；',
  '高度1：普通掩体，阻挡子弹，爆炸减伤30%；',
  '高度2：高墙，阻挡全部直射、射线和喷射，爆炸减伤60%；',
  '高度3：大型遮蔽物，阻挡规则同高度2，爆炸减伤80%。',
  '仅在勾选挡弹道时生效。',
]

export function HeightTipLabel() {
  return <span className="group relative shrink-0 cursor-help border-b border-dotted border-black" tabIndex={0}>高度
    <span role="tooltip" className="pointer-events-none absolute left-0 bottom-full z-50 mb-1 hidden w-64 border-2 border-black bg-[#EFEBD8] p-1.5 text-[8px] font-bold leading-snug text-black shadow-[2px_2px_0_#1A1A18] group-hover:block group-focus:block">{HEIGHT_TIP.map((line, index) => <span key={line} className={`block ${index === HEIGHT_TIP.length - 1 ? 'mt-1 border-t border-black/20 pt-1' : ''}`}>{line}</span>)}</span>
  </span>
}

export function EventEditorModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-label={title} className="comic-panel relative flex h-[min(640px,88vh)] w-[min(820px,94vw)] flex-col overflow-hidden bg-[#D2CCA9]">
        <header className="flex shrink-0 items-center gap-2 border-b-2 border-black px-3 py-2">
          <h2 className="font-comic text-[13px] font-black">{title}</h2>
          <button type="button" aria-label="关闭事件编辑窗口" className="comic-btn ml-auto px-2 py-0.5 text-[10px]" onClick={onClose}>×</button>
        </header>
        <div className="level-editor-inline-fields min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pr-[202px] max-[640px]:pr-3">{children}</div>
      </section>
    </div>,
    document.body,
  )
}
