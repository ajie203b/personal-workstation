/** 小尺寸导航中的单色品牌标记。 */
export function BrandMark() {
  return (
    <span className="grid place-items-center size-11 shrink-0 text-primary" aria-hidden>
      <svg width="34" height="34" viewBox="184 184 656 656" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="76">
        <path d="M222 372 L388 608" />
        <path d="M388 372 L222 608" />
        <path d="M468 372 L566 548" />
        <path d="M664 372 L566 640 Q520 772 640 790 Q780 800 790 660 L790 372" />
        <circle cx="790" cy="246" r="46" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}
