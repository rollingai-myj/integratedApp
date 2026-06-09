import { useState } from 'react';

interface Props {
  src: string;
  alt: string;
  code: string;
  className?: string;
}

export function SkuImage({ src, alt, code, className = 'w-10' }: Props) {
  const [err, setErr] = useState(false);
  return (
    <div
      className={`${className} aspect-square shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center`}
    >
      {err || !src ? (
        <span className="text-[10px] text-muted-foreground">{code.slice(-4)}</span>
      ) : (
        <img
          src={src}
          alt={alt}
          onError={() => setErr(true)}
          className="h-full w-full object-contain"
        />
      )}
    </div>
  );
}
