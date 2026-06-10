// Settings panel — same layout/controls as the Premiere extension: Appearance
// (theme + accent), Generation defaults (engine/aspect/duration/versions),
// Behavior. Slides over the editor.
import type { Settings } from '../settings';
import { ACCENT_ORDER, ACCENT_PALETTES, THEME_ORDER } from '../settings';

const Seg = <T extends string>({ value, opts, onChange }: {
  value: T; opts: { val: T; label: string }[]; onChange: (v: T) => void;
}) => (
  <div className="settings-segmented">
    {opts.map((o) => (
      <button key={o.val} className={value === o.val ? 'active' : ''} onClick={() => onChange(o.val)}>{o.label}</button>
    ))}
  </div>
);

const Row: React.FC<{ name: string; hint: string; children: React.ReactNode }> = ({ name, hint, children }) => (
  <div className="settings-row">
    <div className="settings-row-label">
      <div className="settings-row-name">{name}</div>
      <div className="settings-row-hint">{hint}</div>
    </div>
    {children}
  </div>
);

export const SettingsPanel: React.FC<{
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}> = ({ settings, onChange, onClose }) => {
  return (
    <div className="settings-panel show">
      <div className="settings-header">
        <span>Settings</span>
        <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">Appearance</div>
          <Row name="Theme" hint="Color scheme for the app">
            <Seg value={settings.theme} opts={THEME_ORDER as { val: string; label: string }[]} onChange={(v) => onChange({ theme: v })} />
          </Row>
          <Row name="Accent color" hint="Buttons, highlights, selection">
            <div className="settings-swatches">
              {ACCENT_ORDER.map((a) => (
                <button
                  key={a}
                  className={'sw' + (settings.accent === a ? ' active' : '')}
                  style={{ background: ACCENT_PALETTES[a].accent }}
                  aria-label={a}
                  onClick={() => onChange({ accent: a })}
                />
              ))}
            </div>
          </Row>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Defaults for new graphics</div>
          <Row name="Engine" hint="Remotion (React) or HyperFrames (HTML/GSAP)">
            <Seg value={settings.engine} opts={[{ val: 'remotion', label: 'Remotion' }, { val: 'hyperframes', label: 'HyperFrames' }]} onChange={(v) => onChange({ engine: v })} />
          </Row>
          <Row name="Default aspect ratio" hint="Used when generating a graphic; override anytime">
            <Seg value={settings.aspect} opts={[{ val: 'auto', label: 'Auto' }, { val: '9:16', label: '9:16' }, { val: '16:9', label: '16:9' }, { val: '1:1', label: '1:1' }]} onChange={(v) => onChange({ aspect: v })} />
          </Row>
          <Row name="Default duration" hint="Length of a generated graphic">
            <Seg value={settings.duration} opts={[{ val: 'auto', label: 'Auto' }, { val: '3', label: '3s' }, { val: '5', label: '5s' }, { val: '10', label: '10s' }, { val: '15', label: '15s' }, { val: '30', label: '30s' }]} onChange={(v) => onChange({ duration: v })} />
          </Row>
          <Row name="Versions at once" hint="How many variations to generate in parallel (heavier on CPU)">
            <Seg value={settings.versions} opts={[{ val: '1', label: '1' }, { val: '2', label: '2' }, { val: '3', label: '3' }, { val: '5', label: '5' }, { val: 'all', label: 'All' }]} onChange={(v) => onChange({ versions: v })} />
          </Row>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Behavior</div>
          <Row name="Confirm before adding to timeline" hint="Ask before a generated graphic drops onto the timeline">
            <label className="settings-toggle">
              <input type="checkbox" checked={settings.confirmImport} onChange={(e) => onChange({ confirmImport: e.target.checked })} />
              <span />
            </label>
          </Row>
        </div>
      </div>
    </div>
  );
};
