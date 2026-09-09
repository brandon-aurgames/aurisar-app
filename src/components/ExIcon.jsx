import React from 'react';
import { CAT_ICON_COLORS, NAME_ICON_MAP, MUSCLE_ICON_MAP, CAT_ICON_FALLBACK, MUSCLE_COLORS } from '../data/constants';

// The NAME_ICON_MAP regex scan runs per icon render; caching per exercise
// keeps it to once per exercise for the app's lifetime. Name is part of the
// key because custom exercises are renameable. Bounded by catalog size.
const _iconNameCache = new Map();

function getExIconName(ex) {
  if (!ex) return "game-icons:weight-lifting-up";
  const key = (ex.id ?? "") + "::" + (ex.name ?? "");
  const cached = _iconNameCache.get(key);
  if (cached) return cached;
  let icon;
  const nm = (ex.name || "");
  for (const [regex, mapped] of NAME_ICON_MAP) { if (regex.test(nm)) { icon = mapped; break; } }
  if (!icon) {
    const mg = (ex.muscleGroup || "").toLowerCase();
    if (MUSCLE_ICON_MAP[mg]) icon = MUSCLE_ICON_MAP[mg];
  }
  if (!icon) {
    const cat = (ex.category || "").toLowerCase();
    icon = CAT_ICON_FALLBACK[cat] || "game-icons:weight-lifting-up";
  }
  _iconNameCache.set(key, icon);
  return icon;
}

function getExIconColor(ex) {
  if (!ex) return "#b4ac9e";
  const mg = (ex.muscleGroup || "").toLowerCase().trim();
  if (mg && MUSCLE_COLORS[mg]) return MUSCLE_COLORS[mg];
  const cat = (ex.category || "").toLowerCase();
  return CAT_ICON_COLORS[cat] || "#b4ac9e";
}

const ExIcon = React.memo(function ExIcon({ ex, size = "1.15rem", color, style = {} }) {
  if (ex && ex.custom) {
    return (
      <span style={{ fontSize: size, lineHeight: 1, display: "block", ...style }}>
        {ex.icon || "💪"}
      </span>
    );
  }
  const iconName = getExIconName(ex);
  const fill = color || getExIconColor(ex);
  const iconPath = iconName.replace(":", "/");
  const encodedColor = encodeURIComponent(fill);
  const src = `https://api.iconify.design/${iconPath}.svg?color=${encodedColor}`;
  const pxSize = typeof size === "string" && size.endsWith("rem")
    ? (parseFloat(size) * 16) + "px" : size;
  return (
    <img
      src={src}
      alt=""
      width={pxSize}
      height={pxSize}
      loading="lazy"
      decoding="async"
      style={{ display: "block", flexShrink: 0, ...style }}
    />
  );
});

export { getExIconName, getExIconColor, ExIcon };
