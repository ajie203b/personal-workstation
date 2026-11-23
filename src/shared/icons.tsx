import { useId, type JSX, type ReactNode, type SVGProps } from 'react'

export type AppIconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; strokeWidth?: number | string }
export type AppIcon = (props: AppIconProps) => JSX.Element

function make(body: ReactNode): AppIcon {
  return function Icon({ size = 24, strokeWidth: _sw, ...rest }: AppIconProps) {
    void _sw
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...rest}>
        {body}
      </svg>
    )
  }
}

function makeStroke(body: ReactNode, tool?: string): AppIcon {
  return function Icon({ size = 24, strokeWidth, ...rest }: AppIconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        data-tool-icon={tool}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth ?? 1.85}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {body}
      </svg>
    )
  }
}

export const IconToday = makeStroke(
  <>
    <path d="M6.75 15.5a5.25 5.25 0 0 1 10.5 0z" fill="currentColor" fillOpacity="0.16" stroke="none" />
    <path d="M6.75 15.5a5.25 5.25 0 0 1 10.5 0" />
    <path d="M3 15.5h18M7.5 19.5h9" />
    <path d="M12 3.5v2.2M5.2 6.8l1.6 1.6M18.8 6.8l-1.6 1.6" />
  </>,
)

export const IconTasks = makeStroke(
  <>
    <rect x="3" y="4.5" width="7.5" height="7.5" rx="2.4" fill="currentColor" fillOpacity="0.16" />
    <path d="m5.2 8.2 1.6 1.6 3.9-4.1" />
    <path d="M13.5 8.2h7.5M4.5 15.5h16.5M4.5 19.5h10.5" />
    <circle cx="19" cy="19.5" r="1.75" fill="currentColor" stroke="none" />
  </>,
)

export const IconDocs = makeStroke(
  <>
    <path d="M5 6.5a2 2 0 0 1 2-2h6.8l4.7 4.7V18.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="currentColor" fillOpacity="0.14" stroke="none" />
    <path d="M5 5.8A2.3 2.3 0 0 1 7.3 3.5h6.4l5.3 5.3v9.9a2.3 2.3 0 0 1-2.3 2.3H7.3A2.3 2.3 0 0 1 5 18.7z" />
    <path d="M13.5 3.5v4.3a1.5 1.5 0 0 0 1.5 1.5h4" />
    <path d="M8.8 13h6.4M8.8 16.5h4.2" />
  </>,
)

export const IconTools = makeStroke(
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2.2" fill="currentColor" fillOpacity="0.14" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2.2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2.2" />
    <rect x="14.2" y="4.2" width="5.8" height="5.8" rx="1.6" transform="rotate(45 17.1 7.1)" fill="currentColor" fillOpacity="0.22" />
  </>,
)

export const IconStats = makeStroke(
  <>
    <rect x="4" y="12.5" width="3.8" height="7.5" rx="1.6" fill="currentColor" fillOpacity="0.14" />
    <rect x="10.1" y="9" width="3.8" height="11" rx="1.6" fill="currentColor" fillOpacity="0.18" />
    <rect x="16.2" y="5" width="3.8" height="15" rx="1.6" fill="currentColor" fillOpacity="0.24" />
    <path d="M4.5 9.2 10.4 5.2l3.4 1.6L19.2 3" />
    <circle cx="19.5" cy="3" r="1.4" fill="currentColor" stroke="none" />
  </>,
)

export const IconSettings = makeStroke(
  <>
    <path d="M3.5 7.5h3.2M13.3 7.5h7.2M3.5 16.5h7.2M17.3 16.5h3.2" />
    <rect x="6.7" y="4.8" width="6.6" height="5.4" rx="2.7" fill="currentColor" fillOpacity="0.16" />
    <rect x="10.7" y="13.8" width="6.6" height="5.4" rx="2.7" fill="currentColor" fillOpacity="0.16" />
  </>,
)

export const IconBook = make(<path fill="currentColor" d="M13 17.05q1.1-.525 2.213-.788T17.5 16q.9 0 1.763.15T21 16.6V6.7q-.825-.35-1.713-.525T17.5 6q-1.175 0-2.325.3T13 7.2zm-1.662 2.338q-.313-.088-.588-.238q-.975-.575-2.05-.862T6.5 18q-1.05 0-2.062.275T2.5 19.05q-.525.275-1.012-.025T1 18.15V6.1q0-.275.138-.525T1.55 5.2q1.175-.575 2.413-.888T6.5 4q1.45 0 2.838.375T12 5.5q1.275-.75 2.663-1.125T17.5 4q1.3 0 2.538.313t2.412.887q.275.125.413.375T23 6.1v12.05q0 .575-.487.875t-1.013.025q-.925-.5-1.937-.775T17.5 18q-1.125 0-2.2.288t-2.05.862q-.275.15-.587.238t-.663.087t-.663-.088M14 8.776q0-.225.163-.462T14.525 8q.725-.25 1.45-.375T17.5 7.5q.5 0 .988.063t.962.162q.225.05.388.25t.162.45q0 .425-.275.625t-.7.1q-.35-.075-.737-.112T17.5 9q-.65 0-1.275.125t-1.2.325q-.45.175-.737-.025T14 8.775m0 5.5q0-.225.163-.462t.362-.313q.725-.25 1.45-.375T17.5 13q.5 0 .988.063t.962.162q.225.05.388.25t.162.45q0 .425-.275.625t-.7.1q-.35-.075-.737-.112T17.5 14.5q-.65 0-1.275.113t-1.2.312q-.45.175-.737-.012T14 14.275m0-2.75q0-.225.163-.462t.362-.313q.725-.25 1.45-.375t1.525-.125q.5 0 .988.063t.962.162q.225.05.388.25t.162.45q0 .425-.275.625t-.7.1q-.35-.075-.737-.112t-.788-.038q-.65 0-1.275.125t-1.2.325q-.45.175-.737-.025t-.288-.65" />)

export const IconSun = make(<path fill="currentColor" d="M11 3V2q0-.425.288-.712T12 1t.713.288T13 2v1q0 .425-.288.713T12 4t-.712-.288T11 3m0 19v-1q0-.425.288-.712T12 20t.713.288T13 21v1q0 .425-.288.713T12 23t-.712-.288T11 22m11-9h-1q-.425 0-.712-.288T20 12t.288-.712T21 11h1q.425 0 .713.288T23 12t-.288.713T22 13M3 13H2q-.425 0-.712-.288T1 12t.288-.712T2 11h1q.425 0 .713.288T4 12t-.288.713T3 13m16.75-7.325l-.35.35q-.275.275-.687.275T18 6q-.275-.275-.288-.687t.263-.713l.375-.375q.275-.3.7-.3t.725.3t.288.725t-.313.725M6.025 19.4l-.375.375q-.275.3-.7.3t-.725-.3t-.288-.725t.313-.725l.35-.35q.275-.275.688-.275T6 18q.275.275.288.688t-.263.712m12.3.35l-.35-.35q-.275-.275-.275-.687T18 18q.275-.275.688-.287t.712.262l.375.375q.3.275.3.7t-.3.725t-.725.288t-.725-.313M4.6 6.025l-.375-.375q-.3-.275-.3-.7t.3-.725t.725-.288t.725.313l.35.35q.275.275.275.688T6 6q-.275.275-.687.288T4.6 6.025M7.75 16.25Q6 14.5 6 12t1.75-4.25T12 6t4.25 1.75T18 12t-1.75 4.25T12 18t-4.25-1.75" />)

export const IconDone = make(<path fill="currentColor" d="M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2q1.2 0 2.338.275t2.187.8q.375.2.488.6t-.138.75t-.663.45t-.812-.1q-.8-.375-1.663-.575T12 4Q8.675 4 6.337 6.338T4 12t2.338 5.663T12 20t5.663-2.337T20 12q0-.2-.012-.387t-.038-.388q-.05-.425.163-.812t.637-.513q.4-.125.75.075t.4.6q.05.35.075.7T22 12q0 2.075-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m-1.4-8.2l9.3-9.325q.275-.275.688-.288t.712.288q.275.275.275.7t-.275.7L11.3 15.9q-.3.3-.7.3t-.7-.3l-2.85-2.85q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275z" />)

function assetIcon(path: string, inset = 0): AppIcon {
  return function ToolAssetIcon({ size = 24, strokeWidth: _sw, ...rest }: AppIconProps) {
    void _sw
    const clipId = useId()
    const dim = 24 - inset * 2
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...rest}>
        <defs>
          <clipPath id={clipId}>
            <rect x="0.5" y="0.5" width="23" height="23" rx="6.2" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <image
            x={inset}
            y={inset}
            width={dim}
            height={dim}
            preserveAspectRatio="xMidYMid slice"
            href={`${import.meta.env.BASE_URL}${path}.png`}
          />
        </g>
      </svg>
    )
  }
}

export const IconToolNovel = assetIcon('brands/fanqie', 0.4)
export const IconToolArchive = assetIcon('brands/annas-archive', 1.2)
export const IconToolDownload = makeStroke(
  <>
    <rect x="3" y="4" width="18" height="12" rx="3" fill="currentColor" fillOpacity=".14" />
    <path d="M12 9v12m-4-4 4 4 4-4" />
  </>, 'media',
)
export const IconToolQr = makeStroke(
  <>
    <g fill="currentColor" fillOpacity=".14">
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4" />
    </g>
    <path d="M14 14h3v3h3.5M14 19v1.5h3m3.5 0h.01" />
  </>, 'qr',
)
export const IconToolPdf = makeStroke(
  <>
    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="currentColor" fillOpacity=".14" />
    <path d="M14 3v5h5M8.5 12h7m-7 4h4" />
  </>, 'pdf',
)
export const IconToolArticle = makeStroke(
  <>
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" fill="currentColor" fillOpacity=".14" />
    <path d="M7 8h6m-6 4h10m-10 4h7" />
    <path d="M16 4v5l1.5-1L19 9V4" fill="currentColor" stroke="none" />
  </>, 'article',
)
export const IconToolIdPhoto = makeStroke(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2.5" fill="currentColor" fillOpacity=".14" />
    <circle cx="9" cy="10" r="2" />
    <path d="M5.8 16a3.3 3.3 0 0 1 6.4 0M15 10h3m-3 4h2" />
  </>, 'idphoto',
)
export const IconToolOcr = makeStroke(
  <>
    <path d="M4 9V6a2 2 0 0 1 2-2h3m6 0h3a2 2 0 0 1 2 2v3m0 6v3a2 2 0 0 1-2 2h-3m-6 0H6a2 2 0 0 1-2-2v-3" />
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" fillOpacity=".14" stroke="none" />
    <path d="M8.5 9h7M12 9v7" />
  </>, 'ocr',
)
export const IconToolMath = makeStroke(
  <>
    <path d="M4 19h16V6c-8 0-7 12-16 13Z" fill="currentColor" fillOpacity=".14" stroke="none" />
    <path d="M4 4v15h17M6.5 15c6 0 5-9 13-9" />
  </>, 'math',
)
export const IconToolReport = makeStroke(
  <>
    <rect x="5" y="3" width="14" height="18" rx="2" fill="currentColor" fillOpacity=".14" />
    <path d="M8.5 7h7m-7 4h2m3 0h2m-7 3h2m3 0h2m-7 3h7" />
  </>, 'report',
)
