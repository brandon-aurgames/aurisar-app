// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FilterDropdown, { NARROW_MQ } from '../FilterDropdown';
import Sheet from '../../../components/ui/Sheet';

function installMatchMedia(matches) {
  const listeners = new Set();
  const mql = {
    matches,
    media: NARROW_MQ,
    addEventListener: (_e, fn) => listeners.add(fn),
    removeEventListener: (_e, fn) => listeners.delete(fn),
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn),
    dispatch(next) {
      mql.matches = next;
      listeners.forEach(fn => fn({ matches: next, media: NARROW_MQ }));
    },
  };
  window.matchMedia = query => (query === NARROW_MQ ? mql : {
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  return mql;
}

function Harness({ startOpen = false }) {
  const [open, setOpen] = useState(startOpen ? 'type' : null);
  const [selected, setSelected] = useState(() => new Set());
  const toggle = v => setSelected(s => {
    const n = new Set(s);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  });
  return (
    <FilterDropdown
      id="type"
      label="Type"
      shortLabel="Type"
      options={['strength', 'cardio']}
      optionLabel={v => v}
      selected={selected}
      counts={new Map([['strength', 3], ['cardio', 1]])}
      onToggle={toggle}
      open={open === 'type'}
      setOpen={setOpen}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FilterDropdown keyboard', () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  it('opens from the trigger, arrows through options, and Escape returns focus', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Type' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const list = await waitFor(() => screen.getByRole('listbox', { name: 'Type' }));
    await waitFor(() => expect(document.activeElement).toBe(list));
    fireEvent.keyDown(list, { key: ' ' });
    expect(screen.getByRole('button', { name: /Type \(1\)/ })).toBeTruthy();
    fireEvent.keyDown(list, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole('listbox', { name: 'Type' })).toBeNull();
  });
});

describe('FilterDropdown narrow sheet', () => {
  it('focuses the listbox after the sheet mounts and Escape closes only the filter', async () => {
    installMatchMedia(true);
    const onParentEscape = vi.fn();
    render(
      <Sheet open onClose={onParentEscape} title="Add exercises" ariaLabel="Add exercises to workout">
        <Harness />
      </Sheet>
    );
    const trigger = screen.getByRole('button', { name: 'Type' });
    fireEvent.click(trigger);
    const list = await waitFor(() => screen.getByRole('listbox', { name: 'Type' }));
    await waitFor(() => expect(document.activeElement).toBe(list));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: ' ' });
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
    fireEvent.keyDown(list, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Type' })).toBeNull());
    expect(onParentEscape).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole('dialog', { name: 'Add exercises to workout' })).toBeTruthy();
  });

  it('keeps the listbox focused when crossing the 520px breakpoint while open', async () => {
    const mql = installMatchMedia(true);
    render(<Harness startOpen />);
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Type' })).toBeTruthy());
    expect(screen.getByText('None selected')).toBeTruthy();
    act(() => { mql.dispatch(false); });
    const wideList = await waitFor(() => screen.getByRole('listbox', { name: 'Type' }));
    expect(screen.queryByText('None selected')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(wideList));
    act(() => { mql.dispatch(true); });
    const sheetList = await waitFor(() => screen.getByRole('listbox', { name: 'Type' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(sheetList));
  });
});
