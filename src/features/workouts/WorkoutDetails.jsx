import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Sheet from '../../components/ui/Sheet';
import { normalizeHHMM } from '../../utils/time';
import { createDetailsFire } from './detailsFire';
import './workout-details.css';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function WorkoutDetails({ name, notes, intensity, onSave, session, availableLabels = [] }) {
  const [phase, setPhase] = useState('idle');
  const [hovered, setHovered] = useState(false);
  const [origin, setOrigin] = useState(200);
  const [newLabel, setNewLabel] = useState('');
  const [draft, setDraft] = useState({ name: '', notes: '', intensity: '' });
  const [paused, setPaused] = useState(document.hidden);
  const trigger = useRef(null), dialog = useRef(null), canvas = useRef(null), fire = useRef(null);
  const timer = useRef(null), positionAnchor = useRef(null);
  const id = useId();
  const active = phase !== 'idle';
  // Escape scroll-area clipping, but stay inside #root so the modal stack
  // makes this trigger inert alongside the rest of the app while a sheet opens.
  const triggerHost = document.getElementById('root') || document.body;

  // Follow the name panel vertically and the builder's edge horizontally.
  useEffect(() => {
    const anchor = positionAnchor.current;
    const hud = anchor.closest('.hud');
    let frame = 0;
    function schedulePosition() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; position(); });
    }
    function position() {
      const rect = anchor.getBoundingClientRect();
      trigger.current?.style.setProperty('--wd-top', `${Math.max(100, Math.min(rect.top + 8, window.innerHeight - 120))}px`);
      trigger.current?.style.setProperty('--wd-left', `${Math.max(0, hud?.getBoundingClientRect().left || 0)}px`);
    }
    position();
    const observer = new ResizeObserver(schedulePosition);
    observer.observe(document.body);
    if (hud) observer.observe(hud);
    window.addEventListener('resize', schedulePosition);
    document.addEventListener('scroll', schedulePosition, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedulePosition); document.removeEventListener('scroll', schedulePosition, true); };
  }, []);

  useEffect(() => {
    function visibility() { setPaused(document.hidden); if (document.hidden) fire.current?.stop(); }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    function motionChanged(e) {
      if (!e.matches) return;
      fire.current?.stop(); clearTimeout(timer.current);
      setPhase(current => current === 'closing' ? 'idle' : current === 'opening' ? 'open' : current);
    }
    document.addEventListener('visibilitychange', visibility);
    media.addEventListener?.('change', motionChanged);
    return () => { document.removeEventListener('visibilitychange', visibility); media.removeEventListener?.('change', motionChanged); clearTimeout(timer.current); };
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    fire.current = createDetailsFire(canvas.current);
    fire.current.start();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { fire.current?.destroy(); fire.current = null; document.body.style.overflow = overflow; };
  }, [active]);

  function open() {
    if (active) return;
    setHovered(false);
    // Safari does not focus buttons on pointer click; explicitly capture this
    // trigger before Sheet's lifecycle records the return-focus element.
    trigger.current.focus({ preventScroll: true });
    setDraft({ name, notes, intensity: intensity || '', ...(session ? { session: { ...session, labels: [...session.labels] } } : {}) });
    setNewLabel('');
    const rect = trigger.current.getBoundingClientRect();
    setOrigin(rect.top + rect.height / 2);
    setPhase(reducedMotion() ? 'open' : 'opening');
    clearTimeout(timer.current);
    if (!reducedMotion()) timer.current = setTimeout(() => setPhase('open'), 620);
  }
  function close() {
    if (phase === 'closing' || !active) return;
    clearTimeout(timer.current);
    if (reducedMotion()) { setPhase('idle'); return; }
    setPhase('closing');
    fire.current?.start(360);
    timer.current = setTimeout(() => setPhase('idle'), 360);
  }
  function updateSession(values) {
    setDraft(current => ({ ...current, session: { ...current.session, ...values } }));
  }
  function normalizedDuration(value) {
    const hms = value.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (!hms) return value.trim() ? normalizeHHMM(value.trim()) : '';
    const [, hours, minutes, seconds] = hms.map(Number);
    return `${String(hours + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(Math.min(seconds, 59)).padStart(2, '0')}`;
  }
  function addLabel() {
    const label = newLabel.trim();
    if (!label) return;
    const existing = [...availableLabels, ...draft.session.labels].find(l => l.toLowerCase() === label.toLowerCase()) || label;
    updateSession({ labels: [...new Set([...draft.session.labels, existing])] });
    setNewLabel('');
  }
  function save() {
    if (phase === 'closing') return;
    onSave(draft.session ? { ...draft, session: { ...draft.session, duration: normalizedDuration(draft.session.duration) } } : draft);
    close();
  }
  // A local Tab wrap supplements the app's inert modal stack: even the browser
  // chrome cannot steal the next Tab while the user is working in this form.
  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('*')].filter(el => el.matches('button, input, textarea, summary') && !el.disabled);
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }

  return <>
    <span ref={positionAnchor} aria-hidden="true" />
    {createPortal(<button ref={trigger} type="button" className={`wd-trigger${paused ? ' wd-paused' : ''}`} data-open={active} data-hovered={hovered}
      onPointerEnter={e => { if (e.pointerType !== 'touch') setHovered(true); }}
      onPointerLeave={() => setHovered(false)} onPointerCancel={() => setHovered(false)}
      aria-label="Open workout details" aria-haspopup="dialog" aria-expanded={active} aria-controls={`${id}-dialog`} onClick={open}>
      <span className="wd-handle" aria-hidden="true"><span className="wd-label-vertical">DETAILS</span>
        <span className="wd-label-horizontal">DETAILS<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 3 5 5-5 5" /></svg></span>
      </span><span className="wd-spark" aria-hidden="true" />
    </button>, triggerHost)}
    <Sheet open={active} onClose={close} placement="fullscreen" navOffset={false} showHandle={false} sheetRef={dialog} onKeyDown={trapTab}
      id={`${id}-dialog`} title="WORKOUT DETAILS" ariaLabel="Workout details" ariaDescribedBy={`${id}-subtitle`}
      className="wd-dialog" backdropClassName={`wd-backdrop wd-${phase}${paused ? ' wd-paused' : ''}`}
      atmosphere={<div className="wd-fire" aria-hidden="true" style={{ '--wd-origin': `${origin}px` }}><canvas ref={canvas} /><i className="wd-spark" /><i className="wd-spark" /><i className="wd-spark" /></div>}
      footer={<div className="wd-actions"><button type="button" className="btn btn-ghost wd-secondary" onClick={close}>Cancel</button><button type="submit" form={`${id}-form`} className="btn btn-primary wd-primary">SAVE DETAILS</button></div>}>
      <p id={`${id}-subtitle`} className="wd-subtitle">Configure this session</p>
      <form id={`${id}-form`} className="wd-form" onSubmit={e => { e.preventDefault(); save(); }}>
        <div className="wd-field"><label htmlFor={`${id}-name`}>Workout Name</label>
          <input id={`${id}-name`} className="inp" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name this session" required maxLength={120} /></div>
        <fieldset className="wd-field"><legend>Intensity · optional</legend><div className="wd-intensity">{['Low', 'Moderate', 'High'].map(level => <label key={level}>
          <input type="radio" name={`${id}-intensity`} value={level.toLowerCase()} checked={draft.intensity === level.toLowerCase()} onChange={e => setDraft({ ...draft, intensity: e.target.value })} /><span>{level}</span>
        </label>)}</div>{draft.intensity && <button type="button" className="btn btn-ghost wd-secondary wd-clear-intensity" onClick={() => setDraft({ ...draft, intensity: '' })}>Clear intensity</button>}</fieldset>
        <div className="wd-field"><label htmlFor={`${id}-notes`}>Notes</label><textarea className="inp" id={`${id}-notes`} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="Set your intention. Pace, form, or anything to remember…" rows={4} /></div>
        {draft.session && <>
          <section className="wd-field" aria-labelledby={`${id}-labels-title`}>
            <h2 className="wd-section-label" id={`${id}-labels-title`}>Labels</h2>
            <div className="wd-labels">{[...new Set([...availableLabels, ...draft.session.labels])].map(label => <button type="button" key={label} className="btn btn-ghost wd-secondary" aria-pressed={draft.session.labels.includes(label)} onClick={() => updateSession({ labels: draft.session.labels.includes(label) ? draft.session.labels.filter(l => l !== label) : [...draft.session.labels, label] })}>{label}</button>)}</div>
            <div className="wd-new-label"><input className="inp" aria-label="New label" placeholder="New label…" value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } }} /><button type="button" className="btn btn-ghost wd-secondary" onClick={addLabel}>Add label</button></div>
          </section>
          <section className="wd-field" aria-labelledby={`${id}-stats-title`}>
            <h2 className="wd-section-label" id={`${id}-stats-title`}>Session stats</h2>
            <div className="wd-field"><label htmlFor={`${id}-duration`}>Duration</label><input id={`${id}-duration`} className="inp" inputMode="numeric" value={draft.session.duration} onChange={e => updateSession({ duration: e.target.value, durationSec: '' })} onBlur={e => updateSession({ duration: normalizedDuration(e.target.value) })} placeholder="HH:MM[:SS]" /><small className="wd-subtitle">90 = 1h30m · include :SS for seconds</small></div>
            <div className="wd-calories"><div className="wd-field"><label htmlFor={`${id}-active-cal`}>Active Cal</label><input id={`${id}-active-cal`} className="inp" type="number" min="0" max="9999" value={draft.session.activeCal} onChange={e => updateSession({ activeCal: e.target.value })} /></div><div className="wd-field"><label htmlFor={`${id}-total-cal`}>Total Cal</label><input id={`${id}-total-cal`} className="inp" type="number" min="0" max="9999" value={draft.session.totalCal} onChange={e => updateSession({ totalCal: e.target.value })} /></div></div>
          </section>
        </>}
      </form>
    </Sheet>
  </>;
}
