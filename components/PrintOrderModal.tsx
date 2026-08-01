import { useMemo, useState } from 'react';
import { DisplayPhoto } from '@/lib/types';
import { startPrintCheckout } from '@/lib/api';
import { PRINT_PRODUCTS, findPrintProduct, printShipping, printUnitPrice } from '@/lib/prints';
import { isVideoFilename } from '@/lib/validation';

interface PrintOrderModalProps {
  photos: DisplayPhoto[];
  eventId: string;
  onClose: () => void;
}

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export default function PrintOrderModal({ photos, eventId, onClose }: PrintOrderModalProps) {
  // Prints are for photos only — quietly drop any videos in the selection.
  const printable = useMemo(
    () => photos.filter((photo) => !isVideoFilename(photo.s3Key)),
    [photos],
  );
  const [sku, setSku] = useState(PRINT_PRODUCTS[0].sku);
  const [copies, setCopies] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = findPrintProduct(sku) ?? PRINT_PRODUCTS[0];
  const unit = printUnitPrice(product.baseCost);
  const totalCopies = copies * printable.length;
  const itemsTotal = unit * totalCopies;
  const shipping = printShipping(product, totalCopies);
  const total = itemsTotal + shipping;

  async function handleContinue() {
    if (printable.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const url = await startPrintCheckout(
        eventId,
        printable.map((photo) => ({
          sku,
          copies,
          s3Key: photo.s3Key,
          photoId: photo.id,
        })),
      );
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout could not be started.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Order prints"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold">Order prints</h2>
            <p className="mt-1 text-sm text-ink/60">
              {printable.length} photo{printable.length === 1 ? '' : 's'} · shipped to you
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full bg-smoke px-3 py-1.5 text-sm font-medium hover:bg-ink/10"
          >
            ✕
          </button>
        </div>

        {printable.length === 0 ? (
          <p className="mt-6 rounded-xl bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">
            None of the selected items can be printed. Pick one or more photos (videos can’t be
            printed) and try again.
          </p>
        ) : (
          <>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {printable.slice(0, 8).map((photo) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={photo.id}
                  src={photo.url}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
              ))}
              {printable.length > 8 ? (
                <span className="flex h-16 shrink-0 items-center px-2 text-sm text-ink/60">
                  +{printable.length - 8} more
                </span>
              ) : null}
            </div>

            <fieldset className="mt-5">
              <legend className="text-sm font-semibold">Size</legend>
              <div className="mt-2 space-y-2">
                {PRINT_PRODUCTS.map((option) => (
                  <label
                    key={option.sku}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 ${
                      option.sku === sku ? 'border-accent bg-accent/5' : 'border-ink/15'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="print-size"
                        value={option.sku}
                        checked={option.sku === sku}
                        onChange={() => setSku(option.sku)}
                        className="accent-accent"
                      />
                      <span className="text-sm font-medium">
                        {option.name} · {option.size}
                      </span>
                    </span>
                    <span className="text-sm text-ink/70">
                      {money(printUnitPrice(option.baseCost))} each
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-5 flex items-center justify-between gap-4">
              <span className="text-sm font-semibold">Copies of each photo</span>
              <input
                type="number"
                min={1}
                max={50}
                value={copies}
                onChange={(event) =>
                  setCopies(Math.max(1, Math.min(50, Math.floor(Number(event.target.value) || 1))))
                }
                className="w-20 rounded-lg border border-ink/20 px-3 py-2 text-right"
              />
            </label>

            <dl className="mt-5 space-y-1 border-t border-ink/10 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink/60">
                  {product.size} × {copies} × {printable.length} photo
                  {printable.length === 1 ? '' : 's'}
                </dt>
                <dd>{money(itemsTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink/60">Shipping</dt>
                <dd>{money(shipping)}</dd>
              </div>
              <div className="flex justify-between pt-1 font-semibold">
                <dt>Total</dt>
                <dd>{money(total)}</dd>
              </div>
            </dl>

            {error ? (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <button
              type="button"
              onClick={handleContinue}
              disabled={submitting}
              className="mt-5 w-full rounded-full bg-accent py-3 font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? 'Starting checkout…' : `Continue to payment · ${money(total)}`}
            </button>
            <p className="mt-2 text-center text-xs text-ink/50">
              You’ll enter your shipping address and pay securely on Stripe.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
