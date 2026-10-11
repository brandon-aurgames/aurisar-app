/**
 * Radio-group keyboard model for button[role=radio] groups: one Tab stop
 * (the checked option, else the first), arrows/Home/End move + select and
 * wrap. Pair with `radioTabIndex`.
 */
export function radioTabIndex(index, selectedIndex) {
  return index === (selectedIndex >= 0 ? selectedIndex : 0) ? 0 : -1;
}

export function radioKeyDown(e) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const group = e.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = [...group.querySelectorAll('[role="radio"]:not(:disabled)')];
  const i = radios.indexOf(e.currentTarget);
  if (i < 0 || !radios.length) return;
  e.preventDefault();
  let next;
  if (e.key === "Home") next = 0;
  else if (e.key === "End") next = radios.length - 1;
  else {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    next = (i + dir + radios.length) % radios.length;
  }
  radios[next].focus();
  radios[next].click();
}
