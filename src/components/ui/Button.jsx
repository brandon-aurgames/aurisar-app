import { forwardRef } from 'react';

const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  accent: 'btn-accent',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  glass: 'btn-glass',
  class: 'btn-cls',
};

const SIZE_CLASS = {
  sm: 'btn-sm',
  xs: 'btn-xs',
};

/**
 * Canonical text/action button. It composes the existing global `.btn`
 * styles so callers can migrate without changing their rendered appearance.
 *
 * Defaults to type="button" to prevent accidental form submissions. Use
 * type="submit" explicitly for a form's primary submit action.
 */
const Button = forwardRef(function Button({
  variant = 'secondary',
  size,
  loading = false,
  loadingLabel = 'Working…',
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...rest
}, ref) {
  const classes = [
    'btn',
    VARIANT_CLASS[variant] ?? VARIANT_CLASS.secondary,
    SIZE_CLASS[size],
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
    >
      {loading ? loadingLabel : children}
    </button>
  );
});

export default Button;
