import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrCode({ value, size = 160, className }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg).catch(console.error);
  }, [value]);
  return (
    <div
      role="img"
      aria-label={`QR code for ${value}`}
      className={className}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
