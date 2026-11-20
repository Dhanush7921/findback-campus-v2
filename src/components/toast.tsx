import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface Toast { id: number; tone: Tone; text: string }
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  const icons = { success: CheckCircle2, error: AlertTriangle, info: Info };
  const tones = { success: 'text-emerald-600', error: 'text-rose-600', info: 'text-sky-600' };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 safe-bottom sm:bottom-4 sm:items-end sm:pr-6 no-print">
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl p-4 shadow-[var(--shadow-lift)] animate-rise">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tones[t.tone]}`} aria-hidden />
              <p className="flex-1 text-sm text-ink-800">{t.text}</p>
              <button aria-label="Dismiss" className="rounded p-0.5 text-ink-400 hover:text-ink-700" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}><X className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
