import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'ghost' | 'danger' | 'brass'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  iconRight?: IconName
  loading?: boolean
  block?: boolean
  /** Rendered instead of a <button>; use for router links. */
  as?: 'button' | 'a'
  href?: string
}

/* One component for every action in the app. The variant set is deliberately
   small — primary is the thing the screen exists to do, secondary is the
   working default, and the other three are deliberate steps back. Anything
   that needs a fifth weight is a layout problem, not a button problem. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    loading,
    block,
    as = 'button',
    href,
    className = '',
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const iconSize = size === 'lg' ? 17 : size === 'sm' ? 13 : 15
  const iconOnly = !children && (icon || iconRight)

  const cls = [
    'btn',
    variant,
    size === 'md' ? '' : size,
    block ? 'full' : '',
    iconOnly ? 'icon' : '',
    loading ? 'is-loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const inner = (
    <>
      {loading ? (
        <span className="btn-spin" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {children}
      {!loading && iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
    </>
  )

  if (as === 'a') {
    return (
      <a className={cls} href={href} ref={ref as never} {...(rest as object)}>
        {inner}
      </a>
    )
  }

  return (
    <button
      ref={ref}
      className={cls}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {inner}
    </button>
  )
})

/* A row of buttons that collapse into an overflow menu below `breakpoint`.
   Used in every page header so actions behave the same everywhere. */
export function ButtonRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`btn-row ${className}`}>{children}</div>
}
