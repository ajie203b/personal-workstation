/** 小尺寸导航用的线描品牌标记；完整小马插画保留在应用图标中。 */
export function BrandMark() {
  return (
    <span className="grid place-items-center w-10 h-10 rounded-[12px] bg-primary-soft text-primary border border-primary/10" aria-hidden>
      <svg width="29" height="29" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 26v-4.5l5-6-5.3 1.2c-1 .2-2-.3-2.5-1.2L6.1 13.4 13 8l1-4 4 3c5.2.5 8 4.2 8 9.2V26H10Z" />
        <path d="M18 7c-2.5 1.8-3.4 4.5-2.8 8M9.6 26h17" />
        <circle cx="18.2" cy="11.5" r=".8" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}
