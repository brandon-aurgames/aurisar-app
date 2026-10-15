import React from 'react';
import { illustrationKey } from './illustrationKey';

const ILLUSTRATIONS = {
  "bench-press": (
    <>
      <rect x="20" y="80" width="80" height="8" rx="4" fill="#1e2020" stroke="#858987" strokeWidth="1" />
      <rect x="26" y="88" width="6" height="30" fill="#1e2020" stroke="#858987" strokeWidth="0.8" />
      <rect x="88" y="88" width="6" height="30" fill="#1e2020" stroke="#858987" strokeWidth="0.8" />
      <circle cx="55" cy="72" r="8" fill="#232626" stroke="#858987" strokeWidth="1" />
      <path d="M55 80 L55 88" stroke="#858987" strokeWidth="3" />
      <path d="M55 80 L42 60 M55 80 L68 60" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="58" x2="90" y2="58" stroke="#7ec8e3" strokeWidth="3" strokeLinecap="round" />
      <circle cx="30" cy="58" r="4" fill="#7ec8e3" opacity="0.5" />
      <circle cx="90" cy="58" r="4" fill="#7ec8e3" opacity="0.5" />
      <path d="M42 60 Q55 50 68 60" fill="none" stroke="#7ec8e3" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
    </>
  ),
  "box-squat-bands": (
    <>
      <rect x="35" y="100" width="50" height="20" rx="4" fill="#1e2020" stroke="#858987" strokeWidth="1" />
      <circle cx="60" cy="58" r="8" fill="#232626" stroke="#858987" strokeWidth="1" />
      <path d="M60 66 L60 84" stroke="#858987" strokeWidth="3" />
      <path d="M60 84 L50 100 M60 84 L70 100" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <path d="M52 74 L42 68 M68 74 L78 68" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <line x1="38" y1="68" x2="82" y2="68" stroke="#7ec8e3" strokeWidth="3" strokeLinecap="round" />
      <path d="M40 68 Q35 84 38 100" stroke="#7ec8e3" strokeWidth="1.5" fill="none" strokeDasharray="3 3" opacity="0.6" />
      <path d="M80 68 Q85 84 82 100" stroke="#7ec8e3" strokeWidth="1.5" fill="none" strokeDasharray="3 3" opacity="0.6" />
    </>
  ),
  squat: (
    <>
      <circle cx="60" cy="38" r="8" fill="#232626" stroke="#858987" strokeWidth="1" />
      <path d="M60 46 L60 80" stroke="#858987" strokeWidth="3" />
      <path d="M60 80 L52 100 M60 80 L68 100" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <path d="M52 100 L52 120 M68 100 L68 120" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <path d="M60 52 L46 48 M60 52 L74 48" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <line x1="38" y1="48" x2="82" y2="48" stroke="#7ec8e3" strokeWidth="3" strokeLinecap="round" />
      <circle cx="38" cy="48" r="4" fill="#7ec8e3" opacity="0.5" />
      <circle cx="82" cy="48" r="4" fill="#7ec8e3" opacity="0.5" />
    </>
  ),
  "overhead-press": (
    <>
      <circle cx="60" cy="60" r="8" fill="#232626" stroke="#858987" strokeWidth="1" />
      <path d="M60 68 L60 100" stroke="#858987" strokeWidth="3" />
      <path d="M60 100 L54 120 M60 100 L66 120" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <path d="M60 68 L50 40 M60 68 L70 40" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <line x1="42" y1="40" x2="78" y2="40" stroke="#7ec8e3" strokeWidth="3" strokeLinecap="round" />
      <circle cx="42" cy="40" r="4" fill="#7ec8e3" opacity="0.5" />
      <circle cx="78" cy="40" r="4" fill="#7ec8e3" opacity="0.5" />
    </>
  ),
  deadlift: (
    <>
      <circle cx="70" cy="40" r="8" fill="#232626" stroke="#858987" strokeWidth="1" />
      <path d="M70 48 L50 70" stroke="#858987" strokeWidth="3" />
      <path d="M70 48 L64 100 M70 48 L76 100" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <path d="M50 70 L40 100 M50 70 L60 100" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <line x1="30" y1="104" x2="80" y2="104" stroke="#7ec8e3" strokeWidth="3" strokeLinecap="round" />
      <circle cx="30" cy="104" r="4" fill="#7ec8e3" opacity="0.5" />
      <circle cx="80" cy="104" r="4" fill="#7ec8e3" opacity="0.5" />
    </>
  ),
  "pull-up": (
    <>
      <line x1="30" y1="20" x2="90" y2="20" stroke="#858987" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="50" r="8" fill="#232626" stroke="#858987" strokeWidth="1" />
      <path d="M60 58 L44 24 M60 58 L76 24" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
      <path d="M60 58 L60 90" stroke="#858987" strokeWidth="3" />
      <path d="M60 90 L54 110 M60 90 L66 110" stroke="#858987" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
};

export function ExerciseGlyph({ name, className = "" }) {
  const key = illustrationKey(name);
  if (!key || !ILLUSTRATIONS[key]) return null;
  return (
    <svg
      viewBox="0 0 120 160"
      className={`ex-lib-illustration ${className}`.trim()}
      aria-hidden="true"
    >
      {ILLUSTRATIONS[key]}
    </svg>
  );
}

export default ExerciseGlyph;
