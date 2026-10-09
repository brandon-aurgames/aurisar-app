// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import StagingTray from '../StagingTray';

afterEach(() => { cleanup(); });

it('keeps the Added (N) label and announces the count politely', () => {
  render(
    <StagingTray
      cartIds={['bench']}
      allExById={{ bench: { id: 'bench', name: 'Bench Press', muscleGroup: 'chest' } }}
      isCartRoute
      cartOpen={false}
      setCartOpen={() => {}}
      removeFromCart={() => {}}
      clearCart={() => {}}
      moveInCart={() => {}}
      onForgeWorkout={() => {}}
      onAddToExisting={() => {}}
      onForgePlan={() => {}}
    />
  );
  expect(screen.getByText('Added (1)')).toBeTruthy();
  expect(screen.getByText('1 added').getAttribute('aria-live')).toBe('polite');
});
