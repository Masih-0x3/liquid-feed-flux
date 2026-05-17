import { cn } from '@/lib/utils';

interface BrandLogoProps {
  compact?: boolean;
  className?: string;
  imageClassName?: string;
}

export function BrandLogo({ compact = false, className, imageClassName }: BrandLogoProps) {
  return (
    <div className={cn('overflow-hidden rounded-xl bg-black', className)}>
      <img
        src={compact ? '/favicon.png' : '/xot-logo.png'}
        alt={compact ? 'XOT' : 'XOT Agency'}
        className={cn('h-full w-full object-contain', imageClassName)}
        draggable={false}
      />
    </div>
  );
}
