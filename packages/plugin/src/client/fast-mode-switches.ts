import type { Translate } from '../client-locale.js'
import type { ClientReact, PluginSettingsView } from './types.js'

/**
 * The fork's two fast-mode switches, kept out of `workspaces.ts` on purpose.
 *
 * Upstream rewrites the host section heading in that file every few weeks, and
 * every one of those edits used to collide with this component. Here the whole
 * widget is one import plus one element, and it renders on its own row instead
 * of inside `.dshRemoteSectionTitle`, so the heading can keep changing.
 */
export type ToggleConfigKey = 'liteMode' | 'forceRelay'

const TOGGLES: Record<ToggleConfigKey, { label: 'liteMode' | 'forceRelay', hint: 'liteModeHint' | 'forceRelayHint', endpoint: string }> = {
  liteMode: { label: 'liteMode', hint: 'liteModeHint', endpoint: 'settings.lite.set' },
  forceRelay: { label: 'forceRelay', hint: 'forceRelayHint', endpoint: 'settings.forceRelay.set' },
}

const TOGGLE_ORDER: ToggleConfigKey[] = ['liteMode', 'forceRelay']

export function createFastModeSwitches(React: ClientReact) {
  function RemoteToggleSwitch(props: {
    control: <T>(endpoint: string, payload?: unknown) => Promise<T>
    t: Translate
    configKey: ToggleConfigKey
  }) {
    const meta = TOGGLES[props.configKey]
    const [enabled, setEnabled] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [showHint, setShowHint] = React.useState(false)
    React.useEffect(() => {
      props.control<PluginSettingsView>('settings.get')
        .then(view => setEnabled(view.config[props.configKey] === true))
        .catch(() => undefined)
    }, [props.control, props.configKey])
    const toggle = async (next: boolean) => {
      setEnabled(next)
      setBusy(true)
      try {
        const view = await props.control<PluginSettingsView>(meta.endpoint, { enabled: next })
        setEnabled(view.config[props.configKey] === true)
      } catch {
        setEnabled(!next)
      } finally {
        setBusy(false)
      }
    }
    const label = props.t(meta.label)
    const hint = props.t(meta.hint)
    return React.createElement('div', {
      className: 'dshRemoteHostControlToggle',
      style: { position: 'relative' },
    },
      React.createElement('span', { title: hint, style: { cursor: 'help' } }, label),
      React.createElement('button', {
        type: 'button',
        title: hint,
        'aria-label': hint,
        onClick: () => setShowHint(!showHint),
        style: { width: '14px', height: '14px', borderRadius: '50%', border: '1px solid currentColor', background: 'transparent', color: 'inherit', fontSize: '10px', lineHeight: '12px', padding: '0', cursor: 'pointer', opacity: 0.65, fontFamily: 'inherit' },
      }, '?'),
      React.createElement('input', {
        type: 'checkbox',
        role: 'switch',
        checked: enabled,
        disabled: busy,
        'aria-label': label,
        onChange: (event: Event) => void toggle((event.target as HTMLInputElement).checked),
      }),
      showHint
        ? React.createElement('div', {
          style: { position: 'absolute', top: '100%', left: '0', zIndex: 30, marginTop: '6px', width: '280px', padding: '8px 10px', borderRadius: '6px', background: 'rgba(24,24,28,0.94)', color: '#fff', fontSize: '12px', fontWeight: 400, lineHeight: '1.5', boxShadow: '0 4px 16px rgba(0,0,0,0.28)', whiteSpace: 'normal' },
        }, hint)
        : null,
    )
  }

  return function FastModeSwitches(props: {
    control: <T>(endpoint: string, payload?: unknown) => Promise<T>
    t: Translate
    className?: string
  }) {
    return React.createElement('div', {
      className: props.className ?? 'dshRemoteFastModeSwitches',
    },
      React.createElement('span', { className: 'dshRemoteFastModeGroupTitle' }, props.t('fastModeGroupTitle')),
      TOGGLE_ORDER.map(key => React.createElement(RemoteToggleSwitch, {
        key,
        control: props.control,
        t: props.t,
        configKey: key,
      })))
  }
}
