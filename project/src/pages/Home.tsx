import GamePreview from '@/components/GamePreview'

export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-[#3A3F35] flex items-center justify-center p-0 sm:p-4 relative overflow-hidden">
      {/* 桌面背景噪点/半调 */}
      <div className="absolute inset-0 halftone pointer-events-none" />
      {/* 横版画框：移动端全屏横置；桌面端 16:9 宽屏（上限 1280×720） */}
      <div className="relative w-full h-[100dvh] sm:w-[min(1280px,calc(92dvh*16/9),calc(100vw-2rem))] sm:h-[min(720px,92dvh)] sm:border-[6px] border-black sm:shadow-[10px_10px_0_#1A1A18] bg-[#22241F] overflow-hidden">
        <GamePreview />
      </div>
    </div>
  )
}
