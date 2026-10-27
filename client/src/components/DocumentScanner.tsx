import { useEffect, useRef, useState } from 'react';
import type { DocumentType } from '../lib/api';
import { readIdFromPhoto, warmUpOcr, type ScanResult } from '../lib/ocr';
import { IconCamera, IconKeyboard } from './icons';
import { Alert, Button, Spinner } from './ui';

// ID-1 cards are 85.6 x 54mm with 3 MRZ lines; a passport data page is about 125 x 88mm with 2.
const GUIDE: Record<DocumentType, { ratio: number; lines: number; label: string; what: string }> = {
  national_id: { ratio: 1.586, lines: 3, label: 'Scan your ID', what: 'the front of your ID card' },
  passport: { ratio: 1.42, lines: 2, label: 'Scan your passport', what: 'your passport photo page' },
};

/**
 * One-tap scan: opens the phone's own camera (sharper and better focused than a live video
 * feed), then reads the ID from the photo on the device. The photo is never uploaded.
 */
export function DocumentScanner({
  documentType,
  onResult,
  onManual,
}: {
  documentType: DocumentType;
  onResult: (result: ScanResult) => void;
  onManual: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const guide = GUIDE[documentType];

  useEffect(() => {
    void warmUpOcr().catch(() => {});
  }, []);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFailed(false);
    setProgress(0);
    setPreview(URL.createObjectURL(file));
    try {
      const result = await readIdFromPhoto(file, setProgress);
      if (result) {
        navigator.vibrate?.(60);
        onResult(result);
        return;
      }
      setFailed(true);
    } catch (err) {
      console.error(err);
      setFailed(true);
    } finally {
      setPreview(null);
      if (input.current) input.current.value = '';
    }
  }

  if (preview) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="relative w-full overflow-hidden rounded-3xl bg-slate-900">
          <img src={preview} alt="" className="max-h-80 w-full object-contain opacity-70" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur">
              <Spinner className="h-4 w-4" /> Reading your document…
            </span>
          </div>
        </div>
        <div className="mt-5 h-1 w-48 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${Math.max(8, progress * 100)}%` }} />
        </div>
        <p className="mt-4 text-xs text-slate-400">This happens on your phone. The photo is not uploaded.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">{guide.label}</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          Tap the button and take a photo of {guide.what}. We'll fill in your details for you.
        </p>
      </div>

      <button
        type="button"
        onClick={() => input.current?.click()}
        className="block w-full rounded-3xl bg-slate-50 p-6 transition-colors active:bg-slate-100"
        aria-label={`Open camera to photograph ${guide.what}`}
      >
        <div className="mx-auto w-4/5 rounded-xl border-2 border-dashed border-slate-300 bg-white p-3" style={{ aspectRatio: String(guide.ratio) }}>
          {documentType === 'national_id' ? (
            // Front of the card: photo on one side, printed details on the other.
            <div className="flex h-full gap-3">
              <div className="aspect-[3/4] h-full rounded-md bg-brand-100" />
              <div className="flex flex-1 flex-col justify-center gap-2">
                {[90, 70, 80, 55].map((w) => (
                  <div key={w} className="h-1.5 rounded-full bg-brand-200" style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col justify-end gap-1">
              {Array.from({ length: guide.lines }).map((_, i) => (
                <div key={i} className="h-1.5 rounded-full bg-brand-200" />
              ))}
            </div>
          )}
        </div>
        <p className="mt-4 text-sm text-slate-600">Fill the photo with the card, in good light and with no glare.</p>
      </button>

      {failed && (
        <Alert tone="warning" title="We couldn't read that photo">
          Move closer so the card fills most of the photo, use good light, and hold still. Or type your details instead.
        </Alert>
      )}

      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
      <Button size="lg" onClick={() => input.current?.click()}>
        <IconCamera className="h-5 w-5" /> {failed ? 'Try again' : documentType === 'passport' ? 'Scan passport' : 'Scan ID card'}
      </Button>
      <Button size="lg" variant="secondary" onClick={onManual}>
        <IconKeyboard className="h-5 w-5" /> Type details instead
      </Button>
      <p className="text-center text-xs text-slate-400">Scanning happens on your phone. Nothing is uploaded or saved.</p>
    </div>
  );
}
