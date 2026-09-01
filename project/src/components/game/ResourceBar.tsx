export default function ResourceBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return <div className="flex-1 flex items-center gap-1">
    <span className="text-[9px] font-black text-black shrink-0">{label}</span>
    <div className="flex-1 h-[8px] border-2 border-black bg-black/30">
      <div className="h-full" style={{ width: `${Math.min(100, max > 0 ? (value / max) * 100 : 0)}%`, backgroundColor: color }} />
    </div>
    <span className="text-[9px] font-bold text-black/60 w-6 text-right">{Math.floor(value)}</span>
  </div>
}
