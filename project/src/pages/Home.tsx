import GamePreview from '@/components/GamePreview'

export default function Home() {
  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#3A3F35]">
      {/* 游戏根视口直接占满屏幕，不再限制 16:9、1280×720 或绘制外层黑框。 */}
      <div className="relative h-full w-full overflow-hidden">
        <GamePreview />
      </div>
    </div>
  )
}
