import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import type { DefaultThumbnailCategory } from "./api";

type ThumbnailMap = Partial<Record<DefaultThumbnailCategory, string>>;

// Listing.listingType is free text ("sale" | "rent" | "short_let") — maps
// it onto its own default-thumbnail category. Falls back to the sale
// category for anything unrecognized rather than rendering nothing.
export function listingThumbnailCategory(listingType: string): DefaultThumbnailCategory {
  if (listingType === "rent") return "listing_rent";
  if (listingType === "short_let") return "listing_short_let";
  return "listing_sale";
}

// Fetched once per page load and cached at module scope (these are
// admin-configured platform-wide fallbacks — they don't change per
// account or per session, so every page that renders a listing/vendor/
// product thumbnail can share one fetch instead of each issuing its own).
let cache: ThumbnailMap | null = null;
let inflight: Promise<ThumbnailMap> | null = null;

function fetchThumbnails(auth: ReturnType<typeof useAuth>): Promise<ThumbnailMap> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = auth.api
      .getDefaultThumbnails()
      .then((result) => {
        cache = result;
        return result;
      })
      .catch(() => ({}) as ThumbnailMap);
  }
  return inflight;
}

// Returns the admin-configured platform-wide default thumbnail map,
// {category: imageUrl}, so a page can do
// `photoUrl ?? defaults["listing_sale"]` before falling back to a plain
// placeholder box. Starts as {} (not undefined) so callers never need a
// loading check of their own — worst case it renders the placeholder box
// for one frame, exactly like it already did before this feature existed.
export function useDefaultThumbnails(): ThumbnailMap {
  const auth = useAuth();
  const [thumbnails, setThumbnails] = useState<ThumbnailMap>(cache ?? {});

  useEffect(() => {
    if (cache) return;
    fetchThumbnails(auth).then(setThumbnails);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return thumbnails;
}
