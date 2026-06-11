// Settings panel — same layout/controls as the Premiere extension: Appearance
// (theme, accent, particles, boot intro), Behavior (expand, versions),
// Defaults (engine/aspect/duration/confirm-import), and Data actions. Slides
// over the editor.
import { useState } from 'react';
import type { Settings } from '../settings';
import type { PlanFeatures } from '../api';
import { ACCENT_ORDER, ACCENT_PALETTES, THEME_ORDER, SETTINGS_DEFAULTS } from '../settings';
import { confirmDialog, toast } from '../ui/feedback';

const Seg = <T extends string>({ value, opts, onChange, locked, onLocked }: {
  value: T; opts: { val: T; label: string }[]; onChange: (v: T) => void;
  locked?: (v: T) => boolean; onLocked?: () => void;
}) => (
  <div className="settings-segmented">
    {opts.map((o) => {
      const isLocked = locked ? locked(o.val) : false;
      return (
        <button
          key={o.val}
          className={(value === o.val ? 'active' : '') + (isLocked ? ' locked' : '')}
          onClick={() => (isLocked ? onLocked?.() : onChange(o.val))}
        >{o.label}</button>
      );
    })}
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

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <label className="settings-toggle">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span />
  </label>
);

export const SettingsPanel: React.FC<{
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onClearHistory?: () => void;
  onReset?: () => void;
  features?: PlanFeatures;
}> = ({ settings, onChange, onClose, onClearHistory, onReset, features }) => {
  const verMax = features ? features.maxVersions : 99;
  const verNum = (v: string) => (v === 'all' ? 99 : Number(v) || 1);
  const [cleared, setCleared] = useState(false);
  const [diag, setDiag] = useState('Copy diagnostics');

  const clearHistory = async () => {
    const ok = await confirmDialog({ title: 'Clear render history?', message: 'Removes every entry from your history. Files on disk are not deleted.', okLabel: 'Clear', danger: true });
    if (!ok) return;
    onClearHistory?.();
    setCleared(true); setTimeout(() => setCleared(false), 1500);
  };
  const copyDiag = async () => {
    setDiag('Collecting…');
    const info = {
      app: 'Flimify Studio',
      desktop: !!window.flimify?.isDesktop,
      versions: window.flimify?.versions,
      ua: navigator.userAgent,
      settings,
      ts: new Date().toISOString(),
    };
    try { await navigator.clipboard.writeText(JSON.stringify(info, null, 2)); setDiag('Copied — paste to support'); }
    catch { setDiag('Copy failed'); }
    setTimeout(() => setDiag('Copy diagnostics'), 2000);
  };
  const factoryReset = async () => {
    const ok = await confirmDialog({ title: 'Reset all settings?', message: 'Restores every setting to its default. Your renders and history are untouched.', okLabel: 'Reset', danger: true });
    if (!ok) return;
    onReset ? onReset() : onChange({ ...SETTINGS_DEFAULTS });
    toast('Settings reset to defaults.');
  };

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
                <button key={a} className={'sw' + (settings.accent === a ? ' active' : '')} style={{ background: ACCENT_PALETTES[a].accent }} aria-label={a} onClick={() => onChange({ accent: a })} />
              ))}
            </div>
          </Row>
          <Row name="Particles" hint="Animated accent-colored background">
            <Seg value={settings.particles} opts={[{ val: 'off', label: 'Off' }, { val: 'dust', label: 'Dust' }, { val: 'bokeh', label: 'Bokeh' }, { val: 'stars', label: 'Stars' }, { val: 'network', label: 'Network' }]} onChange={(v) => onChange({ particles: v })} />
          </Row>
          <Row name="Show boot intro" hint="Play the splash animation on launch">
            <Toggle checked={settings.bootIntro} onChange={(v) => onChange({ bootIntro: v })} />
          </Row>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Behavior</div>
          <Row name="Default expand level" hint="The sparkles button default — Low / Mid / High">
            <Seg value={settings.expand} opts={[{ val: 'light', label: 'Low' }, { val: 'medium', label: 'Mid' }, { val: 'heavy', label: 'High' }]} onChange={(v) => onChange({ expand: v })} />
          </Row>
          <Row name="Versions at once" hint={'When generating multiple versions, how many render in parallel' + (verMax < 99 ? ` · your plan allows ${verMax}` : '')}>
            <Seg
              value={settings.versions}
              opts={[{ val: '1', label: '1' }, { val: '2', label: '2' }, { val: '3', label: '3' }, { val: '5', label: '5' }, { val: 'all', label: 'All' }]}
              onChange={(v) => onChange({ versions: v })}
              locked={(v) => verNum(v) > verMax}
              onLocked={() => toast('More versions per prompt is a paid feature — upgrade to unlock.', true)}
            />
          </Row>
          <Row name="Confirm before adding to timeline" hint="Ask before a generated graphic drops onto the timeline">
            <Toggle checked={settings.confirmImport} onChange={(v) => onChange({ confirmImport: v })} />
          </Row>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Defaults for new graphics</div>
          {/* Engine default is always Remotion now; switch per-animation via the
              composer's engine dropdown (owner-only). No global toggle needed. */}
          <Row name="Default aspect ratio" hint="Used when generating a graphic; override anytime">
            <Seg value={settings.aspect} opts={[{ val: 'auto', label: 'Auto' }, { val: '9:16', label: '9:16' }, { val: '16:9', label: '16:9' }, { val: '1:1', label: '1:1' }]} onChange={(v) => onChange({ aspect: v })} />
          </Row>
          <Row name="Default duration" hint="Length of a generated graphic">
            <Seg value={settings.duration} opts={[{ val: 'auto', label: 'Auto' }, { val: '3', label: '3s' }, { val: '5', label: '5s' }, { val: '10', label: '10s' }, { val: '15', label: '15s' }, { val: '30', label: '30s' }]} onChange={(v) => onChange({ duration: v })} />
          </Row>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Data</div>
          <div className="settings-actions">
            <button className="settings-action" onClick={clearHistory}>{cleared ? 'Cleared' : 'Clear render history'}</button>
            <button className="settings-action" onClick={copyDiag}>{diag}</button>
            <button className="settings-action danger" onClick={factoryReset}>Reset all settings</button>
          </div>
        </div>

        <div className="settings-foot">
          Flimify Studio · v0.1.0 · <a href="https://www.flimify.com" target="_blank" rel="noreferrer">flimify.com</a>
          <div className="settings-credit">Made by Flimify ❤ for editors</div>
        </div>
      </div>
    </div>
  );
};
