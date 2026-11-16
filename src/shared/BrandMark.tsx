/** 与启动图标一致的四色品牌标记。 */
export function BrandMark() {
  return (
    <span className="grid place-items-center size-11 shrink-0" aria-hidden>
      <svg width="31" height="31" viewBox="174 174 672 672" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="76">
        <path d="M222 372 L388 608" stroke="#4285F4" />
        <path d="M388 372 L222 608" stroke="#EA4335" />
        <path d="M468 372 L566 548" stroke="#FBBC05" />
        <path d="M664 372 L566 640 Q520 772 640 790 Q780 800 790 660 L790 372" stroke="#34A853" />
        <circle cx="790" cy="246" r="46" fill="#4285F4" />
      </svg>
    </span>
  )
}
