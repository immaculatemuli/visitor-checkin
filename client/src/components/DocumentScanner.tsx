import { useEffect, useRef, useState } from 'react';
import type { DocumentType } from '../lib/api';
import type { MrzResult } from '../lib/mrz';
import { liveCameraSupported, prepareCanvas, readMrzFromPhoto, recognizeMrz, warmUpOcr, type Crop } from '../lib/ocr';
import { IconCamera, IconFlash, IconKeyboard } from './icons';
import { Alert, Button, cx, Spinner } from './ui';

// Guide frame proportions. ID-1 cards are 85.6 x 54mm with 3 MRZ lines; a passport data page
// is about 125 x 88mm with 2 lines. The MRZ fraction is the bottom strip we OCR.
const GUIDE: Record<DocumentType, { ratio: number; mrz: number; label: string; what: string }> = {
  national_id: { ratio: 1.586, mrz: 0.38, label: 'Back of your ID', what: 'the back of your ID card' },
  passport: { ratio: 1.42, mrz: 0.27, label: 'Passport photo page', what: 'your passport photo page' },
};
const FRAME_WIDTH = 0.88; // share of the viewfinder width

export function DocumentScanner({
  documentType,
  onResult,
  onManual,
}: {
  documentType: DocumentType;
  onResult: (result: MrzResult) => void;
  onManual: () => void;
}) {
  const [mode, setMode] = useState<'live' | 'photo'>(() => (liveCameraSupported() ? 'live' : 'photo'));

  useEffect(() => {
    void warmUpOcr().catch(() => {});
  }, []);

  return mode === 'live' ? (
    <LiveScanner documentType={documentType} onResult={onResult} onManual={onManual} onPhoto={() => setMode('photo')} />
  ) : (
    <PhotoScanner documentType={documentType} onResult={onResult} onManual={onManual} />
  );
}

function LiveScanner({
  documentType,
  onResult,
  onManual,
  onPhoto,
}: {
  documentType: DocumentType;
  onResult: (r: MrzResult) => void;
  onManual: () => void;
  onPhoto: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const onResultRef = useRef(onResult);
  const onPhotoRef = useRef(onPhoto);
  onResultRef.current = onResult;
  onPhotoRef.current = onPhoto;

  const [stage, setStage] = useState<'camera' | 'engine' | 'scanning' | 'found'>('camera');
  const [nearly, setNearly] = useState(false);
  const [slow, setSlow] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const guide = GUIDE[documentType];

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    const slowTimer = setTimeout(() => setSlow(true), 15_000);

    // Maps the on-screen MRZ strip to video pixels (the video is drawn with object-fit: cover).
    function mrzCrop(): Crop | null {
      const v = video.current;
      const c = container.current;
      if (!v || !c || !v.videoWidth) return null;
      const scale = Math.max(c.clientWidth / v.videoWidth, c.clientHeight / v.videoHeight);
      const ox = (c.clientWidth - v.videoWidth * scale) / 2;
      const oy = (c.clientHeight - v.videoHeight * scale) / 2;
      const fw = c.clientWidth * FRAME_WIDTH;
      const fh = fw / guide.ratio;
      const fx = (c.clientWidth - fw) / 2;
      const fy = (c.clientHeight - fh) / 2;
      // Pad the strip so slightly misaligned documents still fit.
      const top = fy + fh * (1 - guide.mrz) - fh * 0.06;
      const height = fh * guide.mrz + fh * 0.12;
      const x = Math.max(0, (fx - fw * 0.03 - ox) / scale);
      const y = Math.max(0, (top - oy) / scale);
      return {
        x,
        y,
        w: Math.min(v.videoWidth - x, (fw * 1.06) / scale),
        h: Math.min(v.videoHeight - y, height / scale),
      };
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch {
        if (!cancelled) onPhotoRef.current();
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      track.current = stream.getVideoTracks()[0];
      const caps = track.current.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchAvailable(!!caps?.torch);

      video.current!.srcObject = stream;
      await video.current!.play().catch(() => {});
      setStage('engine');
      await warmUpOcr();
      if (cancelled) return;
      setStage('scanning');

      let frame = 0;
      let previous = '';
      while (!cancelled) {
        const crop = mrzCrop();
        if (!crop) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        // Alternate plain greyscale and black/white frames; each works better in different light.
        const result = await recognizeMrz(prepareCanvas(video.current!, crop, { binarize: frame % 2 === 1 }));
        frame++;
        if (cancelled || !result) continue;

        // Accept a fully valid read, or the same document number + birth date read twice in a row.
        const key = `${result.documentNumber}|${result.dateOfBirth}`;
        if (result.valid || (key === previous && result.checks.documentNumber)) {
          setStage('found');
          navigator.vibrate?.(60);
          stream.getTracks().forEach((t) => t.stop());
          onResultRef.current(result);
          return;
        }
        previous = key;
        setNearly(true);
      }
    })().catch(() => {
      if (!cancelled) onPhotoRef.current();
    });

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [guide]);

  async function toggleTorch() {
    const next = !torchOn;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  const message =
    stage === 'camera'
      ? 'Starting camera…'
      : stage === 'engine'
        ? 'Preparing scanner…'
        : stage === 'found'
          ? 'Got it'
          : nearly
            ? 'Almost there. Hold steady'
            : 'Looking for the <<< lines';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">Scan {guide.label.toLowerCase()}</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          Fit {guide.what} in the frame, with the lines of <span className="font-mono">&lt;&lt;&lt;</span> in the highlighted strip.
        </p>
      </div>

      <div ref={container} className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl bg-slate-900">
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

        {/* Guide frame; the huge shadow dims everything outside it. */}
        <div
          className={cx(
            'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] transition-colors',
            stage === 'found' ? 'border-emerald-400' : 'border-white/90',
          )}
          style={{ width: `${FRAME_WIDTH * 100}%`, aspectRatio: String(guide.ratio) }}
        >
          <div
            className={cx(
              'absolute inset-x-2 bottom-2 overflow-hidden rounded-lg border border-dashed',
              stage === 'found' ? 'border-emerald-300 bg-emerald-400/20' : 'border-white/70 bg-white/10',
            )}
            style={{ height: `${guide.mrz * 100 - 4}%` }}
          >
            {stage === 'scanning' && <div className="absolute inset-x-0 h-0.5 animate-[scan_1.6s_ease-in-out_infinite] bg-brand-500 shadow-[0_0_12px_2px] shadow-brand-500/60" />}
          </div>
        </div>

        <div className="absolute inset-x-0 top-4 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur">
            {(stage === 'camera' || stage === 'engine') && <Spinner className="h-3.5 w-3.5" />}
            {message}
          </span>
        </div>

        {torchAvailable && (
          <button
            onClick={() => void toggleTorch()}
            className={cx('absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur', torchOn ? 'bg-white text-slate-900' : 'bg-black/50 text-white')}
            aria-label="Toggle flashlight"
          >
            <IconFlash className="h-5 w-5" />
          </button>
        )}
      </div>

      {slow && stage === 'scanning' && (
        <Alert tone="info" title="Taking a while?">
          Move into better light, avoid glare, and hold the document flat and still. Or type your details instead.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onPhoto}>
          <IconCamera className="h-5 w-5" /> Take a photo
        </Button>
        <Button variant="secondary" onClick={onManual}>
          <IconKeyboard className="h-5 w-5" /> Type details
        </Button>
      </div>
      <p className="text-center text-xs text-slate-400">Scanning happens on your phone. Nothing is uploaded or saved.</p>
    </div>
  );
}

function PhotoScanner({
  documentType,
  onResult,
  onManual,
}: {
  documentType: DocumentType;
  onResult: (r: MrzResult) => void;
  onManual: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const guide = GUIDE[documentType];

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFailed(false);
    setProgress(0);
    try {
      const result = await readMrzFromPhoto(file, setProgress);
      if (result) onResult(result);
      else setFailed(true);
    } catch (err) {
      console.error(err);
      setFailed(true);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  }

  if (progress !== null) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <Spinner className="h-8 w-8 text-brand-600" />
        <p className="mt-5 font-semibold">Reading your document…</p>
        <div className="mt-4 h-1 w-48 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${Math.max(8, progress * 100)}%` }} />
        </div>
        <p className="mt-4 text-xs text-slate-400">This happens on your phone. The photo is not uploaded.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">Photograph {guide.label.toLowerCase()}</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          Take a close, sharp photo of {guide.what}. Make sure the lines of <span className="font-mono">&lt;&lt;&lt;</span> are clear.
        </p>
      </div>

      <div className="rounded-3xl bg-slate-50 p-5">
        <div className="mx-auto w-4/5 rounded-xl border-2 border-dashed border-slate-300 bg-white p-3" style={{ aspectRatio: String(guide.ratio) }}>
          <div className="flex h-full flex-col justify-end gap-1">
            {Array.from({ length: documentType === 'passport' ? 2 : 3 }).map((_, i) => (
              <div key={i} className="h-1.5 rounded-full bg-brand-200" />
            ))}
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
          <li>• Fill the photo with the document</li>
          <li>• Good light, no glare or shadows</li>
          <li>• Hold steady so the text is sharp</li>
        </ul>
      </div>

      {failed && (
        <Alert tone="warning" title="We couldn't read that photo">
          Try again closer and in better light, or type your details instead.
        </Alert>
      )}

      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
      <Button size="lg" onClick={() => input.current?.click()}>
        <IconCamera className="h-5 w-5" /> {failed ? 'Try again' : 'Open camera'}
      </Button>
      <Button size="lg" variant="secondary" onClick={onManual}>
        <IconKeyboard className="h-5 w-5" /> Type details instead
      </Button>
    </div>
  );
}
