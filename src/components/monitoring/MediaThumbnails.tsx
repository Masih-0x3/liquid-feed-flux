import { ArchivedMediaList } from '@/components/media/ArchivedMediaList';

export function MediaThumbnails({ tweetId, readOnly = false }: { tweetId: string; readOnly?: boolean }) {
  return (
    <section aria-label="Archived media" className="mb-4 space-y-3">
      <h4 className="text-sm font-medium">Media</h4>
      <ArchivedMediaList tweetId={tweetId} readOnly={readOnly} />
    </section>
  );
}
