import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react'

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: number | string
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onValueCommit?: (value: number) => void
  allowEmpty?: boolean
  onEmptyCommit?: () => void
  integer?: boolean
}

function numericBound(value: NumberInputProps['min'] | NumberInputProps['max']): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function numericStep(value: NumberInputProps['step']): number {
  if (value === undefined || value === '' || value === 'any') return 1
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function decimalPlaces(value: number): number {
  const text = String(value).toLowerCase()
  if (text.includes('e-')) return Math.min(12, Number(text.split('e-')[1]) || 0)
  return Math.min(12, text.split('.')[1]?.length ?? 0)
}

function wrapperLayoutClasses(className: string | undefined): string {
  return (className ?? '')
    .split(/\s+/)
    .filter(token => /^(?:w-|min-w-|max-w-|flex-|grow|shrink|self-)/.test(token))
    .join(' ')
}

/**
 * 数值参数输入框：键盘编辑期间不改业务数据；回车或失焦才校验并提交。
 * 原生增减按钮/方向键仍即时提交，并由 min/max 约束在允许范围内。
 */
export default function ValidatedNumberInput({
  value,
  onChange,
  onValueCommit,
  allowEmpty = false,
  onEmptyCommit,
  integer = false,
  min,
  max,
  step = 1,
  className,
  disabled,
  onFocus,
  onBlur,
  onKeyDown,
  onPointerDown,
  'aria-label': ariaLabel,
  ...props
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [warning, setWarning] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const originalRef = useRef(String(value))
  const stepperKeyRef = useRef(false)
  const warningTimerRef = useRef<number | undefined>(undefined)
  const displayValue = draft ?? String(value)

  useEffect(() => () => window.clearTimeout(warningTimerRef.current), [])

  const warnAndRevert = (reason: string) => {
    const label = typeof ariaLabel === 'string' && ariaLabel.trim() ? ariaLabel : '该参数'
    const message = `${label}${reason}，已恢复为原数值 ${originalRef.current || '（空）'}。`
    window.clearTimeout(warningTimerRef.current)
    setWarning(message)
    warningTimerRef.current = window.setTimeout(() => setWarning(''), 3200)
    setDraft(null)
  }

  const emitLegacyChange = (input: HTMLInputElement, nextText: string) => {
    if (!onChange) return
    const target = Object.create(input) as HTMLInputElement
    Object.defineProperty(target, 'value', { configurable: true, value: nextText })
    onChange({ target, currentTarget: target } as ChangeEvent<HTMLInputElement>)
  }

  const commit = (raw: string, input: HTMLInputElement, immediate = false) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      if (!allowEmpty) {
        warnAndRevert('不能为空')
        return false
      }
      onEmptyCommit?.()
      emitLegacyChange(input, '')
      setDraft(null)
      return true
    }

    const parsed = Number(trimmed)
    const lower = numericBound(min)
    const upper = numericBound(max)
    if (!Number.isFinite(parsed)) {
      warnAndRevert('必须是有效数字')
      return false
    }
    if (lower !== undefined && parsed < lower) {
      warnAndRevert(`不能小于 ${lower}`)
      return false
    }
    if (upper !== undefined && parsed > upper) {
      warnAndRevert(`不能大于 ${upper}`)
      return false
    }
    if (integer && !Number.isInteger(parsed)) {
      warnAndRevert('必须是整数')
      return false
    }

    const nextText = integer ? String(Math.round(parsed)) : trimmed
    onValueCommit?.(integer ? Math.round(parsed) : parsed)
    emitLegacyChange(input, nextText)
    if (!immediate) setDraft(null)
    return true
  }

  const adjust = (direction: -1 | 1) => {
    const input = inputRef.current
    if (!input || disabled) return
    // 先聚焦再计算与提交：避免首次点按钮触发 onFocus 后，把旧值重新写回草稿覆盖本次增减。
    input.focus({ preventScroll: true })
    const lower = numericBound(min)
    const upper = numericBound(max)
    const amount = numericStep(step)
    const raw = (draft ?? input.value).trim()
    const parsed = Number(raw)
    const fallback = Number(value)
    let next: number
    if (raw !== '' && Number.isFinite(parsed)) next = parsed + direction * amount
    else if (Number.isFinite(fallback)) next = fallback + direction * amount
    else if (direction > 0) next = lower ?? 0
    else next = upper ?? lower ?? 0
    if (lower !== undefined) next = Math.max(lower, next)
    if (upper !== undefined) next = Math.min(upper, next)
    if (integer) next = Math.round(next)
    else next = Number(next.toFixed(Math.max(decimalPlaces(amount), decimalPlaces(Number.isFinite(parsed) ? parsed : fallback))))
    const nextText = String(next)
    window.clearTimeout(warningTimerRef.current)
    setWarning('')
    onValueCommit?.(next)
    emitLegacyChange(input, nextText)
    originalRef.current = nextText
    setDraft(null)
  }

  return <>
    <span className={`validated-number-input ${wrapperLayoutClasses(className)}`}>
      <input
        {...props}
        ref={inputRef}
        aria-label={ariaLabel}
        aria-invalid={warning ? true : undefined}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={className}
        value={displayValue}
        onFocus={event => {
          originalRef.current = String(value)
          setDraft(event.currentTarget.value)
          onFocus?.(event)
        }}
        onChange={event => {
          const raw = event.currentTarget.value
          const fromStepper = stepperKeyRef.current
          stepperKeyRef.current = false
          if (fromStepper) {
            if (commit(raw, event.currentTarget, true)) {
              originalRef.current = raw
              setDraft(null)
            }
          } else {
            setDraft(raw)
          }
        }}
        onPointerDown={onPointerDown}
        onBlur={event => {
          if (draft !== null) commit(draft, event.currentTarget)
          onBlur?.(event)
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(null)
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            stepperKeyRef.current = true
          }
          onKeyDown?.(event)
        }}
      />
      <span className="validated-number-stepper" aria-hidden={disabled ? true : undefined}>
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={`${typeof ariaLabel === 'string' ? ariaLabel : '数值'}增加`} onPointerDown={event => event.preventDefault()} onClick={() => adjust(1)}>▲</button>
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={`${typeof ariaLabel === 'string' ? ariaLabel : '数值'}减少`} onPointerDown={event => event.preventDefault()} onClick={() => adjust(-1)}>▼</button>
      </span>
    </span>
    {warning && <div role="alert" className="fixed left-1/2 top-3 z-[200] max-w-[min(92vw,460px)] -translate-x-1/2 border-2 border-black bg-[#F2D58A] px-3 py-2 text-center text-[11px] font-black text-[#8B251E] shadow-[3px_3px_0_#000]">{warning}</div>}
  </>
}
