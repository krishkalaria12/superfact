import { env } from "@superfact/env/server";
import { UTApi, UTFile } from "uploadthing/server";

/**
 * File storage, addressed by content rather than by whatever key UploadThing hands back.
 *
 * UploadThing mints its own `{uuid}_{filename}` key and will not accept a path, so a stage that
 * retries would otherwise upload a second copy of the same bytes and orphan the first. Every
 * object this system writes therefore carries a `customId` derived from the content hash, and
 * {@link putObject} clears that id before writing so a retry lands on the same object.
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

export async function putObject(input: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  customId: string;
}): Promise<StoredObject> {
  // Deleting first is what makes the write idempotent: UploadThing rejects a duplicate customId,
  // and there is no upsert. Deleting an id that does not exist is a no-op.
  await storage.deleteFiles([input.customId], { keyType: "customId" });

  const file = new UTFile([input.bytes as unknown as BlobPart], input.filename, {
    type: input.contentType,
    customId: input.customId,
  });

  const { data, error } = await storage.uploadFiles(file);

  if (error || !data) {
    throw new Error(`upload failed for ${input.customId}: ${error?.message ?? "no data returned"}`);
  }

  return { key: data.key, url: data.ufsUrl };
}

export async function removeObjects(customIds: string[]) {
  if (customIds.length === 0) return;
  await storage.deleteFiles(customIds, { keyType: "customId" });
}
