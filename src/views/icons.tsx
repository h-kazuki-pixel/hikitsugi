// Lucide(ISC)のアイコン。使う分だけ SVG のパスを写す(npm パッケージは入れない)。16px、stroke 2、色は currentColor
// 出典: https://lucide.dev (ISC License)

type Props = { size?: number; class?: string };

function Svg(props: Props & { children: unknown }) {
  const s = props.size ?? 16;
  return (
    <svg viewBox="0 0 24 24" width={s} height={s} aria-hidden="true" class={props.class} style={`width:${s}px;height:${s}px`}>
      {props.children as never}
    </svg>
  );
}

export const IconLayoutDashboard = (p: Props = {}) => (
  <Svg {...p}>
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </Svg>
);
export const IconInbox = (p: Props = {}) => (
  <Svg {...p}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Svg>
);
export const IconScanSearch = (p: Props = {}) => (
  <Svg {...p}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="12" r="3" />
    <path d="m16 16-1.9-1.9" />
  </Svg>
);
export const IconListChecks = (p: Props = {}) => (
  <Svg {...p}>
    <path d="m3 17 2 2 4-4" />
    <path d="m3 7 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </Svg>
);
export const IconBookOpen = (p: Props = {}) => (
  <Svg {...p}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </Svg>
);
export const IconPackage = (p: Props = {}) => (
  <Svg {...p}>
    <path d="m7.5 4.27 9 5.15" />
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </Svg>
);
export const IconChartColumn = (p: Props = {}) => (
  <Svg {...p}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </Svg>
);
export const IconBot = (p: Props = {}) => (
  <Svg {...p}>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </Svg>
);
export const IconChevronDown = (p: Props = {}) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconCheck = (p: Props = {}) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
export const IconClock = (p: Props = {}) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Svg>
);
export const IconCamera = (p: Props = {}) => (
  <Svg {...p}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Svg>
);
export const IconUser = (p: Props = {}) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="5" />
    <path d="M20 21a8 8 0 0 0-16 0" />
  </Svg>
);
export const IconPlay = (p: Props = {}) => (
  <Svg {...p}>
    <polygon points="6 3 20 12 6 21 6 3" />
  </Svg>
);
