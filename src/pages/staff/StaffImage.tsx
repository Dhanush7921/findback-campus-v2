import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiBlobUrl } from '../../lib/api';

export function StaffImage({ fileId, alt, className = '' }: { fileId: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    apiBlobUrl(`/api/staff/files/${fileId.replace('/', '~')}`, 'staff').then((x) => { u = x; setUrl(x); }).catch(() => setFailed(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [fileId]);
  if (failed) return <div className={`grid place-items-center bg-silver-50 text-ink-400 ${className}`}><ImageOff className="h-6 w-6" /></div>;
  if (!url) return <div className={`skeleton ${className}`} />;
  return <img src={url} alt={alt} className={`object-cover ${className}`} />;
}
