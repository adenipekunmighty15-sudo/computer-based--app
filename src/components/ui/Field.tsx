import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Icon, type IconName } from './Icon'

interface FieldShell {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  /** Mono count in the label row, e.g. "12 / 200". */
  meter?: ReactNode
  required?: boolean
}

function useFieldParts({ label, hint, error, meter }: FieldShell) {
  const id = useId()
  return { id, label, hint, error, meter }
}

function FieldFrame({
  id,
  label,
  hint,
  error,
  meter,
  required,
  children,
}: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className="field">
      {(label || meter) && (
        <div className="field-top">
          {label ? (
            <label className="field-label" htmlFor={id}>
              {label}
              {required ? <span className="req" aria-hidden="true">*</span> : null}
            </label>
          ) : (
            <span />
          )}
          {meter ? <span className="field-meter">{meter}</span> : null}
        </div>
      )}
      {children}
      {error ? (
        <p className="field-error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type InputProps = FieldShell & InputHTMLAttributes<HTMLInputElement> & { affix?: IconName; size?: 'md' | 'lg' }

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, meter, required, affix, size, className = '', ...rest },
  ref,
) {
  const parts = useFieldParts({ label, hint, error, meter })
  const input = (
    <input
      ref={ref}
      id={parts.id}
      className={`input ${size === 'lg' ? 'lg' : ''} ${className}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${parts.id}-err` : hint ? `${parts.id}-hint` : undefined}
      required={required}
      {...rest}
    />
  )
  const body = affix ? (
    <div className="input-affix">
      <Icon name={affix} size={15} />
      {input}
    </div>
  ) : (
    input
  )
  if (!label && !hint && !error && !meter) return body
  return (
    <FieldFrame {...parts} required={required}>
      {body}
    </FieldFrame>
  )
})

type TextareaProps = FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, meter, required, className = '', ...rest },
  ref,
) {
  const parts = useFieldParts({ label, hint, error, meter })
  return (
    <FieldFrame {...parts} required={required}>
      <textarea
        ref={ref}
        id={parts.id}
        className={`textarea ${className}`}
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      />
    </FieldFrame>
  )
})

type SelectProps = FieldShell & SelectHTMLAttributes<HTMLSelectElement> & { options?: { value: string; label: string }[] }

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, meter, required, options, className = '', children, ...rest },
  ref,
) {
  const parts = useFieldParts({ label, hint, error, meter })
  return (
    <FieldFrame {...parts} required={required}>
      <select
        ref={ref}
        id={parts.id}
        className={`select ${className}`}
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    </FieldFrame>
  )
})

/* Settings live as a label + control pair, not a stack of boxed fields. This is
   the whole settings dialog's layout. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  icon,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  icon?: IconName
}) {
  return (
    <label className="switch-row">
      {icon ? (
        <span className="switch-row-icon">
          <Icon name={icon} size={15} />
        </span>
      ) : null}
      <span className="switch-row-text">
        <span className="switch-row-label">{label}</span>
        {description ? <span className="switch-row-desc">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function CheckRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="checkline">
      <input
        type="checkbox"
        className="check"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export function RadioRow({
  label,
  name,
  checked,
  onChange,
}: {
  label: ReactNode
  name: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="checkline">
      <input type="radio" name={name} className="check radio" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}
