// Auto-Edit wizard — reads the footage speech, asks a couple of quick
// questions, then plans + renders motion graphics and drops them onto the
// timeline at the right moments. A port of the extension's Auto-Edit, on the
// local Claude (no API key). Steps: options → analyzing → questions → running.
import { useEffect, useRef, useState } from 'react';
import { autoeditAnalyze, autoeditRun, type AeAnalysis, type AeApplied } from '../api';
import { toast } from '../ui/feedback';

type Step = 'options' | 'analyzing' | 'questions' | 'running' | 'done';

const DENSITIES = [
  { val: 'sparse', label: 'Sparse', hint: '~3/min · lets it breathe' },
  { val: 'moderate', label: 'Moderate', hint: '~6/min · tasteful' },
  { val: 'dense', label: 'Dense', hint: '~10/min · high-energy' },
  { val: 'full', label: 'Full', hint: 'graphics throughout' },
];
const TONES = [
  { val: 'minimal', label: 'Clean & minimal' },
  { val: 'energetic', label: 'Energetic & punchy' },
  { val: 'editorial', label: 'Bold editorial' },
  { val: 'luxury', label: 'Luxury & moody' },
];

export const AutoEditModal: React.FC<{
  clipId: string;
  clipFrom: number;       // timeline frame where the footage starts
  engine: string;
  onClose: () => void;
  onApply: (applied: AeApplied[], clipFrom: number) => void;
}> = ({ clipId, clipFrom, engine, onClose, onApply }) => {
  const [step, setStep] = useState<Step>('options');
  const [density, setDensity] = useState('moderate');
  const [tone, setTone] = useState('minimal');
  const [analysis, setAnalysis] = useState<AeAnalysis | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [statusText, setStatusText] = useState('');
  const timer = useRef<number | undefined>(undefined);

  // elapsed ticker during analyzing/running
  useEffect(() => {
    if (step !== 'analyzing' && step !== 'running') return;
    setElapsed(0);
    const start = Date.now();
    timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => window.clearInterval(timer.current);
  }, [step]);

  const busy = step === 'analyzing' || step === 'running';

  const analyze = async () => {
    setStep('analyzing');
    try {
      const a = await autoeditAnalyze(clipId);
      setAnalysis(a);
      const init: Record<string, string> = {};
      a.questions.forEach((q) => { if (q.options?.[0]) init[q.id] = q.options[0].value; });
      setAnswers(init);
      setStep('questions');
    } catch (e) {
      toast('Auto-Edit: ' + (e as Error).message, true);
      setStep('options');
    }
  };

  const run = async () => {
    if (!analysis) return;
    setStep('running');
    setStatusText('Planning the edit…');
    try {
      const { applied } = await autoeditRun({ reqId: analysis.reqId, density, tone, answers, engine });
      if (!applied.length) { toast('Auto-Edit produced no graphics.', true); setStep('questions'); return; }
      onApply(applied, clipFrom);
      toast(`Auto-Edit added ${applied.length} graphic${applied.length === 1 ? '' : 's'}.`);
      onClose();
    } catch (e) {
      toast('Auto-Edit failed: ' + (e as Error).message, true);
      setStep('questions');
    }
  };

  return (
    <div className="ae-modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="ae-card">
        <div className="ae-head">
          <span>Auto-Edit</span>
          <button className="settings-close" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>

        {step === 'options' && (
          <div className="ae-body">
            <p className="ae-sub">Read the speech of your footage → plan a few questions → render motion graphics onto the timeline.</p>
            <div className="ae-sec-title">Density</div>
            <div className="ae-grid">
              {DENSITIES.map((d) => (
                <button key={d.val} className={'ae-opt' + (density === d.val ? ' on' : '')} onClick={() => setDensity(d.val)}>
                  <b>{d.label}</b><span>{d.hint}</span>
                </button>
              ))}
            </div>
            <div className="ae-sec-title">Tone</div>
            <div className="ae-grid two">
              {TONES.map((t) => (
                <button key={t.val} className={'ae-opt' + (tone === t.val ? ' on' : '')} onClick={() => setTone(t.val)}>
                  <b>{t.label}</b>
                </button>
              ))}
            </div>
            <div className="ae-foot">
              <button className="ae-next" onClick={analyze}>Next →</button>
            </div>
          </div>
        )}

        {step === 'analyzing' && (
          <div className="ae-working">
            <span className="fp-spin" />
            <div>Reading your video…</div>
            <p>Transcribing the speech and working out what to ask you. <b>{elapsed}s</b></p>
          </div>
        )}

        {step === 'questions' && analysis && (
          <div className="ae-body">
            <p className="ae-sub">{analysis.sentences.length} lines · {analysis.durationSec.toFixed(0)}s. A few quick choices, then I’ll plan, render, and place them.</p>
            {analysis.questions.map((q) => (
              <div className="ae-q" key={q.id}>
                <div className="ae-q-title">{q.q}</div>
                <div className="ae-q-opts">
                  {q.options.map((o) => (
                    <button key={o.value} className={answers[q.id] === o.value ? 'on' : ''} onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.value }))}>{o.label}</button>
                  ))}
                </div>
              </div>
            ))}
            <div className="ae-foot">
              <button className="ae-back" onClick={() => setStep('options')}>← Back</button>
              <button className="ae-next" onClick={run}>Generate →</button>
            </div>
          </div>
        )}

        {step === 'running' && (
          <div className="ae-working">
            <span className="fp-spin" />
            <div>Building your edit…</div>
            <p>{statusText} Rendering graphics on your Claude — this can take a few minutes. <b>{elapsed}s</b></p>
          </div>
        )}
      </div>
    </div>
  );
};
