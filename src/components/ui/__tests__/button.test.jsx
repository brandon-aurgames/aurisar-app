// @vitest-environment jsdom
import React, { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Button from '../Button';

afterEach(cleanup);

describe('Button', () => {
  it('uses the secondary style and a safe button type by default', () => {
    const ref = createRef();
    render(<Button ref={ref} className="dialog-action">Continue</Button>);

    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button.type).toBe('button');
    expect(button.className).toBe('btn btn-secondary dialog-action');
    expect(ref.current).toBe(button);
  });

  it.each([
    ['primary', 'btn-primary'],
    ['accent', 'btn-accent'],
    ['ghost', 'btn-ghost'],
    ['danger', 'btn-danger'],
    ['glass', 'btn-glass'],
    ['class', 'btn-cls'],
  ])('maps the %s variant to its existing style', (variant, expectedClass) => {
    render(<Button variant={variant}>{variant}</Button>);
    expect(screen.getByRole('button', { name: variant }).classList.contains(expectedClass)).toBe(true);
  });

  it('supports compact sizes and explicit submit behavior', () => {
    render(<Button variant="primary" size="sm" type="submit">Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.type).toBe('submit');
    expect(button.classList.contains('btn-sm')).toBe(true);
  });

  it('disables interaction and exposes busy state while loading', () => {
    const onClick = vi.fn();
    render(<Button loading loadingLabel="Saving…" onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
