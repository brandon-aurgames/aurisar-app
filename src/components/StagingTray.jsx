import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { ExIcon } from './ExIcon';
import { getMuscleColor } from '../utils/xp';

/**
 * Shared add tray. Visible whenever the cart has items on a cart route.
 * Collapsed it is a single steel bar; expanded it lists the picks and the
 * three destinations.
 */

const StagingTray = memo(function StagingTray({
  cartIds,
  allExById,
  isCartRoute,
  cartOpen, setCartOpen,
  removeFromCart, clearCart, moveInCart,
  onForgeWorkout,
  onAddToExisting,
  onForgePlan,
}) {
  if (!cartIds.length || !isCartRoute) return null;

  const exercises = cartIds.map(id => allExById[id]).filter(Boolean);

  return createPortal(
    <div className={`cart-tray${cartOpen ? " cart-tray-open" : ""}`} role="region" aria-label="Added exercises">
      <button
        type="button"
        className={"cart-tray-bar"}
        aria-expanded={cartOpen}
        onClick={() => setCartOpen(o => !o)}
      >
        <span className={"cart-tray-count"} aria-hidden="true">{cartIds.length}</span>
        <span className={"cart-tray-label"}>{`Added (${cartIds.length})`}</span>
        <span className={"sr-only"} aria-live={"polite"} aria-atomic={"true"}>{`${cartIds.length} added`}</span>
        <span className={"cart-tray-chevron"} aria-hidden="true">{cartOpen ? "▾" : "▴"}</span>
      </button>

      {cartOpen && <div className={"cart-tray-body"}>
        <ul className={"cart-tray-list"}>
          {exercises.map((ex, i) => {
            const mg = getMuscleColor(ex.muscleGroup);
            return (
              <li key={ex.id} className={"cart-tray-item"} style={{ "--mg-color": mg }}>
                <span className={"cart-tray-idx"} aria-hidden="true">{i + 1}</span>
                <span className={"cart-tray-orb"}><ExIcon ex={ex} size={"0.85rem"} color={mg} /></span>
                <span className={"cart-tray-name"}>{ex.name}</span>
                <span className={"cart-tray-actions"}>
                  <button type="button" className={"btn-sm"} onClick={() => moveInCart(ex.id, -1)} disabled={i === 0} aria-label={`Move ${ex.name} earlier`}>{"↑"}</button>
                  <button type="button" className={"btn-sm"} onClick={() => moveInCart(ex.id, 1)} disabled={i === exercises.length - 1} aria-label={`Move ${ex.name} later`}>{"↓"}</button>
                  <button type="button" className={"btn-sm"} onClick={() => removeFromCart(ex.id)} aria-label={`Remove ${ex.name}`}>{"✕"}</button>
                </span>
              </li>
            );
          })}
        </ul>

        <div className={"cart-tray-forge"}>
          <button type="button" className={"cart-forge-btn cart-forge-primary btn-sm"} onClick={onForgeWorkout}>{"New Workout"}</button>
          <button type="button" className={"cart-forge-btn btn-sm"} onClick={onAddToExisting}>{"Add to existing"}</button>
          <button type="button" className={"cart-forge-btn btn-sm"} onClick={onForgePlan}>{"Add to Plan"}</button>
        </div>
        <button type="button" className={"cart-tray-clear btn-sm"} onClick={clearCart}>{"Clear"}</button>
      </div>}
    </div>,
    document.body
  );
});

export default StagingTray;
