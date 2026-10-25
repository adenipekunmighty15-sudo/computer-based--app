import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SubjectPicker } from './SubjectPicker'

const empty = () => {}

describe('SubjectPicker', () => {
  it('renders all three phases of the school system', () => {
    render(<SubjectPicker value={[]} onChange={empty} />)
    expect(screen.getByText('Primary school')).toBeInTheDocument()
    expect(screen.getByText('Junior Secondary (JSS)')).toBeInTheDocument()
    expect(screen.getByText('Senior Secondary (SSS)')).toBeInTheDocument()
  })

  it('narrows the chips to the search term', () => {
    render(<SubjectPicker value={[]} onChange={empty} />)
    fireEvent.change(screen.getByLabelText('Search subjects'), { target: { value: 'mathematics' } })
    // Mathematics appears on the Primary, JSS and SSS lists.
    expect(screen.getAllByRole('button', { name: 'Mathematics' })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Biology' })).not.toBeInTheDocument()
  })

  it('emits a selection when a chip is pressed', () => {
    const onChange = vi.fn()
    render(<SubjectPicker value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Physics' }))
    expect(onChange).toHaveBeenCalledWith([{ level: 'SSS', subject: 'Physics' }])
  })

  it('marks an already-selected subject as pressed', () => {
    render(
      <SubjectPicker
        value={[{ level: 'JSS', subject: 'Mathematics' }, { level: 'SSS', subject: 'Physics' }]}
        onChange={empty}
      />,
    )
    expect(screen.getByRole('button', { name: 'Physics' })).toHaveAttribute('aria-pressed', 'true')
    // The JSS Mathematics chip is its own button.
    const maths = screen.getAllByRole('button', { name: 'Mathematics' })
    expect(maths.some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true)
  })

  it('does not exceed the maximum selection', () => {
    const onChange = vi.fn()
    render(
      <SubjectPicker
        value={[{ level: 'SSS', subject: 'Physics' }, { level: 'SSS', subject: 'Chemistry' }]}
        onChange={onChange}
        max={2}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Biology' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})