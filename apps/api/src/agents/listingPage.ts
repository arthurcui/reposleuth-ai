/** Fits a listing page into the current output allowance without dropping continuation metadata. */
import { type BoundedResult, RepositoryError } from '../github/RepositoryProvider.js';

export function listingPage(listing: BoundedResult<string>, offset: number, maxBytes: number) {
  const result = { ...listing, items: [...listing.items], nextOffset: listing.nextOffset ?? null };
  const fits = () => {
    const text = JSON.stringify(result);
    return text.length <= 30000 && Buffer.byteLength(text) <= maxBytes;
  };
  if (fits()) return result;
  result.truncated = true;
  result.warnings = [
    ...listing.warnings,
    'Output allowance shortened this page; continue with nextOffset and the same prefix.',
  ];
  while (result.items.length && !fits()) {
    result.items.pop();
    result.nextOffset = offset + result.items.length;
  }
  if (!result.items.length || !fits())
    throw new RepositoryError('OUTPUT_LIMIT', 'Narrow the listing prefix.');
  return result;
}
