import { useState } from 'react';
import { Users } from 'lucide-react';

interface AvatarProps {
  name: string;
  src?: string;
  isGroup?: boolean;
  online?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES = {
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function Avatar({ name, src, isGroup, online, size = 'md' }: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`relative shrink-0 ${SIZE_CLASSES[size]}`}>
      {isGroup ? (
        <div className="w-full h-full rounded-full bg-[#2A3942] border border-white/10 flex items-center justify-center text-[#00A884]">
          <Users className={size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'} />
        </div>
      ) : src && !imgError ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full rounded-full object-cover border border-white/10 bg-[#202C33]"
        />
      ) : (
        <div className="w-full h-full rounded-full bg-[#2A3942] border border-white/10 flex items-center justify-center font-display font-semibold text-[#E9EDEF]">
          {getInitials(name)}
        </div>
      )}

      {online && !isGroup && (
        <span
          title="Aktif di Jaringan Lokal"
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#00A884] ring-2 ring-[#111B21]"
        />
      )}
    </div>
  );
}
