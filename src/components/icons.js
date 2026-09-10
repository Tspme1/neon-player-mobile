// SVG 图标库 — 保持与桌面端相同的 SVG path
import React from 'react';
import Svg, { Path, Circle, Line, Polyline, Polygon, Rect, Ellipse, Text } from 'react-native-svg';

const defaultProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const PlayIcon = (p) => (
  <Svg {...defaultProps} {...p}><Path d="M8 5v14l11-7z" fill="currentColor" stroke="none" /></Svg>
);
export const PauseIcon = (p) => (
  <Svg {...defaultProps} {...p}><Path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor" stroke="none" /></Svg>
);
export const PrevIcon = (p) => (
  <Svg {...defaultProps} {...p}><Path d="M19 20L9 12l10-8v16zM7 20H5V4h2v16z" fill="currentColor" stroke="none" /></Svg>
);
export const NextIcon = (p) => (
  <Svg {...defaultProps} {...p}><Path d="M5 4l10 8-10 8V4zm12 0h2v16h-2V4z" fill="currentColor" stroke="none" /></Svg>
);
export const HeartIcon = ({ filled, ...p }) => (
  <Svg {...defaultProps} fill={filled ? 'currentColor' : 'none'} {...p}>
    <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </Svg>
);
export const SearchIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="11" cy="11" r="8" />
    <Line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>
);
export const MusicIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M9 18V5l12-2v13" />
    <Circle cx="6" cy="18" r="3" />
    <Circle cx="18" cy="16" r="3" />
  </Svg>
);
export const ListIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Line x1="8" y1="6" x2="21" y2="6" />
    <Line x1="8" y1="12" x2="21" y2="12" />
    <Line x1="8" y1="18" x2="21" y2="18" />
    <Line x1="3" y1="6" x2="3.01" y2="6" />
    <Line x1="3" y1="12" x2="3.01" y2="12" />
    <Line x1="3" y1="18" x2="3.01" y2="18" />
  </Svg>
);
export const GlobeIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="12" cy="12" r="10" />
    <Line x1="2" y1="12" x2="22" y2="12" />
    <Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </Svg>
);
export const TrophyIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <Path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <Path d="M4 22h16" />
    <Path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <Path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <Path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </Svg>
);
export const FlameIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </Svg>
);
export const CompassIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="12" cy="12" r="10" />
    <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </Svg>
);
export const VolumeOnIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
    <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </Svg>
);
export const VolumeMuteIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
    <Line x1="23" y1="9" x2="17" y2="15" />
    <Line x1="17" y1="9" x2="23" y2="15" />
  </Svg>
);
export const ShuffleIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polyline points="16 3 21 3 21 8" />
    <Line x1="4" y1="20" x2="21" y2="3" />
    <Polyline points="21 16 21 21 16 21" />
    <Line x1="15" y1="15" x2="21" y2="21" />
    <Line x1="4" y1="4" x2="9" y2="9" />
  </Svg>
);
export const RepeatIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polyline points="17 1 21 5 17 9" />
    <Path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <Polyline points="7 23 3 19 7 15" />
    <Path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </Svg>
);
export const RepeatOneIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polyline points="17 1 21 5 17 9" />
    <Path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <Polyline points="7 23 3 19 7 15" />
    <Path d="M21 13v2a4 4 0 0 1-4 4H3" />
    <Text x="12" y="15" fontSize="8" fill="currentColor" stroke="none" textAnchor="middle" fontWeight="bold">1</Text>
  </Svg>
);
export const SequenceIcon = RepeatIcon;
export const PlusIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Line x1="12" y1="5" x2="12" y2="19" />
    <Line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);
export const DownloadIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <Polyline points="7 10 12 15 17 10" />
    <Line x1="12" y1="15" x2="12" y2="3" />
  </Svg>
);
export const TrashIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polyline points="3 6 5 6 21 6" />
    <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>
);
export const ChevronLeftIcon = (p) => (
  <Svg {...defaultProps} {...p}><Polyline points="15 18 9 12 15 6" /></Svg>
);
export const ChevronDownIcon = (p) => (
  <Svg {...defaultProps} {...p}><Polyline points="6 9 12 15 18 9" /></Svg>
);
export const CloseIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Line x1="18" y1="6" x2="6" y2="18" />
    <Line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);
export const SettingsIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);
export const SunIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="12" cy="12" r="5" />
    <Line x1="12" y1="1" x2="12" y2="3" />
    <Line x1="12" y1="21" x2="12" y2="23" />
    <Line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <Line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <Line x1="1" y1="12" x2="3" y2="12" />
    <Line x1="21" y1="12" x2="23" y2="12" />
    <Line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <Line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </Svg>
);

export const MoreIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
    <Circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <Circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const ClockIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="12" cy="12" r="10" />
    <Polyline points="12 6 12 12 16 14" />
  </Svg>
);

export const ShareIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="18" cy="5" r="3" />
    <Circle cx="6" cy="12" r="3" />
    <Circle cx="18" cy="19" r="3" />
    <Line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <Line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </Svg>
);

export const FolderIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </Svg>
);

export const PaletteIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    <Circle cx="17.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <Circle cx="8.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
    <Circle cx="6.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </Svg>
);

export const HeadphonesIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <Path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </Svg>
);

export const HardDriveIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Line x1="22" y1="12" x2="2" y2="12" />
    <Path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    <Line x1="6" y1="16" x2="6.01" y2="16" />
    <Line x1="10" y1="16" x2="10.01" y2="16" />
  </Svg>
);

export const RadioIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="12" cy="12" r="2" />
    <Path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </Svg>
);

export const DatabaseIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Ellipse cx="12" cy="5" rx="9" ry="3" />
    <Path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <Path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </Svg>
);

export const UploadIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <Polyline points="17 8 12 3 7 8" />
    <Line x1="12" y1="3" x2="12" y2="15" />
  </Svg>
);

export const RefreshCwIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polyline points="23 4 23 10 17 10" />
    <Polyline points="1 20 1 14 7 14" />
    <Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </Svg>
);

export const CheckIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const CheckCircleIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <Polyline points="22 4 12 14.01 9 11.01" />
  </Svg>
);

export const FolderPlusIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <Line x1="12" y1="11" x2="12" y2="17" />
    <Line x1="9" y1="14" x2="15" y2="14" />
  </Svg>
);

export const AlertCircleIcon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Circle cx="12" cy="12" r="10" />
    <Line x1="12" y1="8" x2="12" y2="12" />
    <Line x1="12" y1="16" x2="12.01" y2="16" />
  </Svg>
);

export const Volume2Icon = (p) => (
  <Svg {...defaultProps} {...p}>
    <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <Path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </Svg>
);

