import { cn } from '@/lib/utils';

interface BrandLogoProps {
  compact?: boolean;
  className?: string;
  imageClassName?: string;
}

export function BrandLogo({ compact = false, className, imageClassName }: BrandLogoProps) {
  const source = compact ? '/xot-logo-compact.webp' : '/xot-logo-full.webp';
  const fallback = compact ? '/favicon.png' : '/xot-logo.png';
  const dimension = compact ? 64 : 320;

  return (
    <div className={cn('aspect-square overflow-hidden rounded-xl bg-black', className)}>
      <picture className="block h-full w-full">
        <source type="image/webp" srcSet={source} />
        <img
          src={fallback}
          width={dimension}
          height={dimension}
          alt={compact ? 'XOT' : 'XOT Agency'}
          className={cn('h-full w-full object-contain', imageClassName)}
          draggable={false}
        />
      </picture>
    </div>
  );
}
