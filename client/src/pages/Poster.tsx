import { publicUrl } from '../lib/format';
import { QrCode } from '../components/QrCode';
import { Button, NysStripe } from '../components/ui';

/** A4 poster for the reception desk. Open it and print (Ctrl+P), or save as PDF. */
export default function Poster() {
  const url = publicUrl('/checkin');
  return (
    <div className="min-h-dvh bg-slate-100 print:bg-white">
      <div className="no-print flex justify-center p-4">
        <Button onClick={() => window.print()}>Print poster</Button>
      </div>
      <div className="mx-auto flex h-[297mm] w-[210mm] flex-col bg-white shadow-xl print:shadow-none">
        <NysStripe className="h-[4mm]" />
        <div className="flex flex-1 flex-col items-center px-[20mm] pb-[12mm] pt-[10mm] text-center">
          <img src="/nys-banner.png" alt="Republic of Kenya, National Youth Service" className="h-[26mm] w-auto" />
          <p className="mt-[6mm] text-[13pt] font-bold uppercase tracking-[0.18em] text-brand-700">National Youth Service Headquarters</p>
          <h1 className="mt-[3mm] text-[44pt] font-bold leading-none tracking-tight">Visitor Check-in</h1>
          <p className="mt-[5mm] text-[17pt] text-slate-500">Visitors and attachees, please check in before going in.</p>

          <div className="mt-[9mm] rounded-[10mm] border-[1.2mm] border-brand-600 p-[7mm]">
            <QrCode value={url} size={300} />
          </div>
          <p className="mt-[7mm] text-[20pt] font-semibold">Scan with your phone camera</p>
          <p className="mt-[2mm] font-mono text-[12pt] text-slate-400">{url}</p>

          <ol className="mt-auto grid w-full grid-cols-3 gap-[8mm]">
            {[
              ['1', 'Scan this code', 'No app needed'],
              ['2', 'Photograph your ID', 'The front. It stays on your phone'],
              ['3', 'Show your pass', 'Check out when you leave'],
            ].map(([n, title, sub]) => (
              <li key={n}>
                <span className="mx-auto flex h-[12mm] w-[12mm] items-center justify-center rounded-full bg-brand-600 text-[16pt] font-bold text-white">{n}</span>
                <p className="mt-[3mm] text-[13pt] font-semibold">{title}</p>
                <p className="text-[11pt] text-slate-500">{sub}</p>
              </li>
            ))}
          </ol>

          <p className="mt-[9mm] text-[10.5pt] text-slate-400">
            No smartphone? Please check in at the reception desk. Personal data is processed under the Kenya Data Protection Act, 2019.
          </p>
        </div>
        <NysStripe className="h-[4mm]" />
      </div>
    </div>
  );
}
