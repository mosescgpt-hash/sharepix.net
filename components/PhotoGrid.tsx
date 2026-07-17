import { DisplayPhoto } from '@/lib/types';
import PhotoCard from '@/components/PhotoCard';

interface PhotoGridProps {
  photos: DisplayPhoto[];
  emptyMessage?: string;
}

export default function PhotoGrid({ photos, emptyMessage }: PhotoGridProps) {
  if (photos.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-ink/20 bg-white px-4 py-12 text-center text-ink/60">
        {emptyMessage ?? 'No photos yet. Scan the event QR code to add the first one.'}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {photos.map((photo) => (
        <PhotoCard key={photo.id} photo={photo} />
      ))}
    </div>
  );
}
