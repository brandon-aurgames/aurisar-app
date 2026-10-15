import React from 'react';

/** Consistent line-art equipment icons. No emoji, no generic-repeat fallback. */
const ICONS = {
  barbell: (
    <path d="M6.5 6.5v11M4 9v6M17.5 6.5v11M20 9v6M6.5 12h11" />
  ),
  dumbbell: (
    <path d="M7 7v10M4.5 9v6M19.5 9v6M17 7v10M7 12h10" />
  ),
  kettlebell: (
    <>
      <circle cx="12" cy="14" r="7" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M8 7h8" />
    </>
  ),
  cable: (
    <path d="M5 12h4M15 12h4M9 12a3 3 0 0 0 6 0M9 12a3 3 0 0 1 6 0" />
  ),
  machine: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  bodyweight: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v6M12 9l-4 3M12 9l4 3M8 20l4-8 4 8" />
    </>
  ),
  band: (
    <ellipse cx="12" cy="12" rx="6" ry="9" transform="rotate(20 12 12)" />
  ),
  "medicine ball": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4.5 12h15M12 4.5c2.4 2.2 3.6 4.8 3.6 7.5S14.4 17.3 12 19.5C9.6 17.3 8.4 14.7 8.4 12S9.6 6.7 12 4.5z" />
    </>
  ),
  landmine: (
    <path d="M6 18h12M8 18V9l4-4 4 4v9" />
  ),
  rings: (
    <>
      <circle cx="8" cy="14" r="5" />
      <circle cx="16" cy="14" r="5" />
      <path d="M8 9V4M16 9V4" />
    </>
  ),
};

export function EquipIcon({ equipment, size = 16, title }) {
  const key = String(equipment || "bodyweight").toLowerCase().trim();
  const paths = ICONS[key] || ICONS.bodyweight;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {paths}
    </svg>
  );
}

export default EquipIcon;
