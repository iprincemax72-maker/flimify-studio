// The Flimify AI panel — docked in the editor. Prompt → the local studio-bridge
// spawns Claude → renders an alpha overlay → it drops onto the timeline. The
// no-API-key generation model from the Premiere extension, now in the app.
import { useState } from 'react';
import { generate, type BridgeClip } from '../api';

type Engine = 'remotion' | 'hyperframes';

export const FlimifyPanel: React.FC<{
  width: number;
  height: number;
  onClip: (clip: BridgeClip) => void;
}> = ({ width, height, onClip }) => {
  const [prompt, setPrompt] = useState('');
  const [engine, setEngine] = useState<Engine>('remotion');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ role: 'you' | 'flimify'; text: string }[]>([
    { role: 'flimify', text: 'Describe a graphic — a lower-third, a title, a callout. I’ll generate it and drop it on the timeline.' },
  ]);

  const send = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setPrompt('');
    setLog((l) => [...l, { role: 'you', text: p }]);
    setBusy(true);
    setLog((l) => [...l, { role: 'flimify', text: 'Generating… (running on your Claude — no API key)' }]);
    try {
      const clip = await generate(p, engine, width, height, 4);
      onClip(clip);
      setLog((l) => [...l.slice(0, -1), { role: 'flimify', text: '✓ Added “' + clip.name + '” to V2.' }]);
    } catch (e) {
      setLog((l) => [...l.slice(0, -1), { role: 'flimify', text: '✗ ' + (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flimify-panel">
      <div className="fp-engine">
        <button className={engine === 'remotion' ? 'on' : ''} onClick={() => setEngine('remotion')}>Remotion</button>
        <button className={engine === 'hyperframes' ? 'on' : ''} onClick={() => setEngine('hyperframes')}>HyperFrames</button>
      </div>
      <div className="fp-log">
        {log.map((m, i) => (
          <div key={i} className={'fp-msg ' + m.role}>{m.text}</div>
        ))}
      </div>
      <div className="fp-input">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="e.g. a lower-third that says JANE DOE, Designer"
          disabled={busy}
          rows={2}
        />
        <button className="fp-send" onClick={send} disabled={busy || !prompt.trim()}>
          {busy ? '…' : 'Generate'}
        </button>
      </div>
    </div>
  );
};
