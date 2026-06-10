// Captions studio — pick a style + a few knobs, then transcribe (parakeet) and
// render an animated caption overlay onto the timeline. A focused port of the
// extension's captions panel (style grid + position/words/case/size/color/
// stroke/shadow); transcript-review + the live preview engine are follow-ups.
import { useState } from 'react';
import type { CaptionOptions } from '../api';

export type CaptionStyle = string;

const STYLES: { value: string; label: string; desc: string }[] = [
  { value: 'fadeup', label: 'Fade Up', desc: 'Letters fade in + rise, word by word' },
  { value: 'fadedown', label: 'Fade Down', desc: 'Letters fade in + drop, word by word' },
  { value: 'fadeleft', label: 'Fade Left', desc: 'Slide in from the left, word by word' },
  { value: 'faderight', label: 'Fade Right', desc: 'Slide in from the right, word by word' },
  { value: 'wordup', label: 'Word by Word', desc: 'Each word fades in + rises as spoken' },
  { value: 'worddown', label: 'Word Down', desc: 'Each word fades in + drops as spoken' },
  { value: 'classic', label: 'Classic', desc: 'Clean fade-in, full line' },
  { value: 'minimal', label: 'Minimal', desc: 'Understated, low-key' },
  { value: 'karaoke', label: 'Karaoke', desc: 'Active word highlights as sung' },
  { value: 'tiktok', label: 'TikTok Pop', desc: 'Words type on with a wobble' },
  { value: 'reels', label: 'Big Bold', desc: 'Punchy spring pop, 1–3 words' },
  { value: 'hormozi', label: 'Hormozi', desc: 'Bold; active word in a color box' },
];

const HIGHLIGHTS = ['#E2885F', '#F5C542', '#4ECB71', '#5AA9FF', '#FF5D8F', '#FFFFFF'];

export const CaptionsModal: React.FC<{
  onClose: () => void;
  onGenerate: (style: string, wordsPerLine: number, options: CaptionOptions) => void;
  busy: boolean;
}> = ({ onClose, onGenerate, busy }) => {
  const [style, setStyle] = useState('fadeup');
  const [wordsPerLine, setWords] = useState(4);
  const [position, setPosition] = useState<'top' | 'middle' | 'bottom'>('bottom');
  const [uppercase, setUppercase] = useState(false);
  const [fontScale, setFontScale] = useState(100);
  const [highlight, setHighlight] = useState('#E2885F');
  const [stroke, setStroke] = useState(2);
  const [shadow, setShadow] = useState(55);

  const go = () => onGenerate(style, wordsPerLine, {
    position, uppercase, fontScale: fontScale / 100, highlight, stroke, shadow: shadow / 100,
  });

  return (
    <div className="cap-modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="cap-card">
        <div className="cap-head">
          <span>Captions</span>
          <button className="settings-close" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>

        {busy ? (
          <div className="cap-working">
            <span className="fp-spin" />
            <div>Making your captions…</div>
            <p>Transcribing word-by-word, then rendering the overlay. This runs on your Claude — no API key.</p>
          </div>
        ) : (
          <div className="cap-body">
            <div className="cap-sec-title">Style</div>
            <div className="cap-styles">
              {STYLES.map((s) => (
                <button key={s.value} className={'cap-style' + (style === s.value ? ' on' : '')} onClick={() => setStyle(s.value)} title={s.desc}>
                  <b>{s.label}</b><span>{s.desc}</span>
                </button>
              ))}
            </div>

            <div className="cap-sec-title">Options</div>
            <div className="cap-opts">
              <label className="cap-opt"><span>Words per line</span><input type="range" min={1} max={8} value={wordsPerLine} onChange={(e) => setWords(+e.target.value)} /><i>{wordsPerLine}</i></label>
              <div className="cap-opt"><span>Position</span>
                <div className="settings-segmented">
                  {(['top', 'middle', 'bottom'] as const).map((p) => (
                    <button key={p} className={position === p ? 'active' : ''} onClick={() => setPosition(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
                  ))}
                </div>
              </div>
              <label className="cap-opt"><span>Font size</span><input type="range" min={70} max={150} step={5} value={fontScale} onChange={(e) => setFontScale(+e.target.value)} /><i>{fontScale}%</i></label>
              <label className="cap-opt"><span>Stroke</span><input type="range" min={0} max={8} value={stroke} onChange={(e) => setStroke(+e.target.value)} /><i>{stroke}px</i></label>
              <label className="cap-opt"><span>Shadow</span><input type="range" min={0} max={100} step={5} value={shadow} onChange={(e) => setShadow(+e.target.value)} /><i>{shadow}%</i></label>
              <div className="cap-opt"><span>Highlight</span>
                <div className="cap-swatches">
                  {HIGHLIGHTS.map((c) => (
                    <button key={c} className={'cap-sw' + (highlight === c ? ' on' : '')} style={{ background: c }} onClick={() => setHighlight(c)} aria-label={c} />
                  ))}
                </div>
              </div>
              <label className="cap-opt cap-toggle"><span>UPPERCASE</span>
                <label className="settings-toggle"><input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} /><span /></label>
              </label>
            </div>
          </div>
        )}

        <div className="cap-foot">
          <button className="cap-gen" onClick={go} disabled={busy}>{busy ? 'Generating…' : 'Generate captions'}</button>
        </div>
      </div>
    </div>
  );
};
