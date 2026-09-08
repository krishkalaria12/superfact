import { env } from "@superfact/env/server";
import { UTApi, UTFile } from "uploadthing/server";

/**
 * File storage, addressed by content rather than by whatever key UploadThing hands back.
 *
 * UploadThing mints its own `{uuid}_{filename}` key and will not accept a path, so a stage that
 * retries would otherwise upload a second copy of the same bytes and orphan the first. Every
 * object this system writes therefore carries a `customId` derived from content — the document
 * hash, plus the page index for a raster.
 *
 * That makes an existing object the *correct* object: the same id can only ever have been written
 * from the same bytes. {@link putObject} therefore reuses what is already there rather than
 * replacing it, and nothing in the parse path deletes.
 *
 * Deleting is what must be avoided. UploadThing tombstones a deleted `customId`: the id keeps
 * answering `409 File already exists` while being absent from both `listFiles` and `getFileUrls`,
 * so it can never be written again and nothing can read what used to be there. A delete-then-write
 * "upsert" therefore destroys the object and then cannot restore it. {@link removeObjects} exists
 * for genuine cleanup and should be treated as one-way.
 */

const storage = new UTApi({ token: env.UPLOADTHING_TOKEN });

/** The original PDF. One object per distinct document, whatever it was named on the way in. */
export function documentObjectId(contentHash: string) {
  return `doc:${contentHash}`;
}

/** A rendered page raster. Phase 03 writes these; the id shape is fixed here so it stays stable. */
export function pageRasterObjectId(contentHash: string, pageIndex: number) {
  return `page:${contentHash}:${pageIndex}`;
}

export type StoredObject = { key: string; url: string };

/**
 * The object already stored under this id, or null.
 *
 * `getFileUrls` is the only call that resolves a customId to a public URL — `generateSignedURL`
 * takes a storage key, which is exactly what we do not know. It is marked deprecated for removal
 * in UploadThing v9; when that lands this needs the replacement lookup, not a return to deleting.
 */
async function findObject(customId: string): Promise<StoredObject | null> {
  const { data } = await storage.getFileUrls([customId], { keyType: "customId" });
  const found = data[0];
  return found ? { key: found.key, url: found.url } : null;
}

/**
 * Attempts before giving up. The first two reuse the canonical id, so an ordinary hiccup still
 * lands on the deterministic object; later ones disambiguate, which is the only way past an id
 * that has been tombstoned.
 */
const UPLOAD_ATTEMPTS = 4;
const CANONICAL_ATTEMPTS = 2;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function putObject(input: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  customId: string;
}): Promise<StoredObject> {
  let last = "";

  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    // A tombstoned id refuses every write and reveals nothing, so past the canonical attempts the
    // only way to store the page at all is under a different id. The page row records whichever id
    // won, so determinism is an optimisation here and not something correctness rests on.
    const id =
      attempt < CANONICAL_ATTEMPTS
        ? input.customId
        : `${input.customId}#${attempt - CANONICAL_ATTEMPTS + 1}`;

    // Uploading before looking up keeps the common path — a page never stored before — to one
    // request. The lookup only pays for itself when something is already there.
    const file = new UTFile([input.bytes as unknown as BlobPart], input.filename, {
      type: input.contentType,
      customId: id,
    });

    const { data, error } = await storage.uploadFiles(file);
    if (data) return { key: data.key, url: data.ufsUrl };

    last = `${error?.code ?? "UNKNOWN"}: ${error?.message ?? "no data returned"}`;

    // Either this id was written by an earlier run or a concurrent batch won the race. Both mean
    // the stored bytes are the bytes we were about to send, because the id is derived from them.
    const existing = await findObject(id);
    if (existing) return existing;

    // Nothing readable under that id and the write failed. Either the provider is throttling, or
    // the id is tombstoned and never coming back. Backing off covers the first; the next attempt's
    // fresh id covers the second.
    await wait(2 ** attempt * 400);
  }

  throw new Error(`upload failed for ${input.customId} after ${UPLOAD_ATTEMPTS} attempts: ${last}`);
}
export async function removeObjects(customIds: string[]) {
  if (customIds.length === 0) return;
  await storage.deleteFiles(customIds, { keyType: "customId" });
}
