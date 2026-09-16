import { useId } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'

export type RuntimeParameterChoice = {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export function RuntimePickerCheck(): React.JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3.5 8.2 2.8 2.8 6.2-6.2" /></svg>
}

export function RuntimePickerChevron(): React.JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
}

/** Short Runtime enums share the model picker surface; only model catalogs need search. */
export function RuntimeParameterSelect({ label, value, choices, defaultChoice, disabled, onChange }: {
  label: string
  value: string
  choices: RuntimeParameterChoice[]
  defaultChoice?: RuntimeParameterChoice
  disabled: boolean
  onChange(value: string): void
}): React.JSX.Element {
  const id = useId()
  const selected = [...choices, ...(defaultChoice ? [defaultChoice] : [])].find(choice => choice.value === value)
  return <div className="field-label">
    <label htmlFor={id}>{label}</label>
    <Menu.Root>
      <Menu.Trigger asChild>
        <button id={id} type="button" className="runtime-model-picker-trigger" disabled={disabled}
          aria-label={[label, selected?.label ?? value, selected?.description].filter(Boolean).join('，')}
          title={[selected?.label ?? value, selected?.description].filter(Boolean).join('\n')}>
          <span><strong>{selected?.label ?? value}</strong>{selected?.description && <small>{selected.description}</small>}</span><RuntimePickerChevron />
        </button>
      </Menu.Trigger>
      <Menu.Portal><Menu.Content className="runtime-model-picker-menu runtime-parameter-picker-menu"
        align="start" sideOffset={5} collisionPadding={10} loop>
        <Menu.RadioGroup className="runtime-picker-options" value={value} onValueChange={next => { if (!disabled) onChange(next) }}>
          <div className="runtime-picker-scroll">{choices.map(choice => <Choice key={choice.value} choice={choice} disabled={disabled} />)}</div>
          {defaultChoice && <div className="runtime-picker-default"><Choice choice={defaultChoice} disabled={disabled} /></div>}
        </Menu.RadioGroup>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </div>
}

function Choice({ choice, disabled }: { choice: RuntimeParameterChoice; disabled: boolean }): React.JSX.Element {
  return <Menu.RadioItem className="runtime-model-picker-item" value={choice.value}
    textValue={[choice.label, choice.description].filter(Boolean).join(' ')}
    disabled={disabled || choice.disabled} title={[choice.label, choice.description].filter(Boolean).join('\n')}>
    <span className="runtime-model-picker-copy"><strong>{choice.label}</strong>{choice.description && <small>{choice.description}</small>}</span>
    <Menu.ItemIndicator className="runtime-model-picker-check"><RuntimePickerCheck /></Menu.ItemIndicator>
  </Menu.RadioItem>
}
