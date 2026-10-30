// @ts-nocheck — vendored inscription core (HCS-1/HCS-6), source: SLIME new-tools shared/core
// The metadata JSON (HIP-412) that is inscribed for each piece. Building it is pure: no page, no network.

/** Written into every piece's metadata as properties.inscribed_with: the mark of the tool that made it (permanent once inscribed). */
export const MADE_WITH = 'BuiltBySlime Creator Kit — Inscribe NFTs (Hashinal)';
/** Shown in the page's metadata preview until a creator is entered. Never inscribed: a creator is required. */
export const NO_CREATOR = '<creator — required>';
/** The metadata format. */
export const FORMAT = 'HIP412@2.0.0';

/**
 * Build a piece's metadata. image is the main file's address (hcs://1/<topic>), mime its type; files is the files[]
 * list (defaults to just the main file); attributes are traits ([{trait_type, value}], left out when not given);
 * standard is 'HCS-5' (fixed) or 'HCS-6' (updatable); extra goes into properties after the tool's mark (e.g. collection,
 * piece, of, version, note; undefined values are dropped when written). Throws if creator is empty.
 * Key order is fixed, so the same input always gives the same bytes (and the same hash).
 */
export function buildMetadata({ name, creator, description, image, mime, files, attributes, standard = 'HCS-5', extra = {} }: any) {
  if (!creator) throw new Error('A creator is required.');
  const m: any = { name: name || '', creator, description: description || '', image, type: mime, format: FORMAT,
    files: files || [{ uri: image, type: mime, is_default_file: true }] };
  if (attributes !== undefined) m.attributes = attributes;
  m.properties = { standard, inscribed_with: MADE_WITH, ...extra };
  return m;
}
