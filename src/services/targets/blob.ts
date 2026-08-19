// Blob persistence for the weekly targets upload (item 1, 2026-07-07). Same DefaultAzureCredential
// auth pattern already used for the Fabric SQL pool (sql-pool.ts) — no new auth idiom.
//
// Layout in the `weekly-targets` container:
//   raw/<timestamp>.xlsx     the uploaded workbook, unmodified (audit)
//   parsed/<timestamp>.json  the derived StoredTargets (audit)
//   current.json             pointer blob, written LAST — a crash mid-upload never leaves it
//                             pointing at a half-written upload.

import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import type { ParsedTargets } from "./parse.js";
import type { CapturedMap } from "./store.js";

const CONTAINER = "weekly-targets";
const CURRENT_POINTER = "current.json";

export interface StoredTargets {
  parsed: ParsedTargets;
  uploadedBy: string;
  uploadedAt: string;
  /** Persisted so a RESTART does not quietly launder a partial import into "all Capricorn's targets".
   *  Both were in-memory only until 2026-08-19: the board would state the caveat until App Service
   *  recycled, then drop it and claim every figure came from the upload. Optional because blobs
   *  written before then have neither — see the legacy floor in unconfirmedFrom().
   *
   *  `captured` is the per-figure map, stored rather than its inverse: it is the source of truth, and
   *  the still-ours list the board reads is derived from it (store.unconfirmedFrom). Storing both would
   *  let a blob contradict itself. Absent = "this blob predates per-figure provenance", which is NOT
   *  the same as "nothing was captured" and must not be flattened into it. */
  note?: string;
  captured?: CapturedMap;
}

let credential: DefaultAzureCredential | undefined;

function containerClient(storageAccount: string): ContainerClient {
  credential ??= new DefaultAzureCredential();
  const service = new BlobServiceClient(`https://${storageAccount}.blob.core.windows.net`, credential);
  return service.getContainerClient(CONTAINER);
}

/** Persist a validated upload, pointer written last. Call BEFORE activating the in-memory cache —
 *  never the other order, so a failed write can't leave the UI claiming success while nothing
 *  durable happened. */
export async function uploadTargetsBlob(
  storageAccount: string,
  rawWorkbook: Buffer,
  parsed: ParsedTargets,
  uploadedBy: string,
  uploadedAt: string,
  opts: {
    note?: string;
    captured?: CapturedMap;
    /** Extension for the audit artefact. Not every activation comes from a workbook — the leads
     *  form posts JSON — and filing that under `.xlsx` would leave an audit trail that lies about
     *  what was submitted. */
    rawExt?: string;
  } = {},
): Promise<void> {
  const container = containerClient(storageAccount);
  await container.createIfNotExists();
  const stamp = uploadedAt.replace(/[:.]/g, "-");
  const stored: StoredTargets = { parsed, uploadedBy, uploadedAt, note: opts.note, captured: opts.captured };
  const json = Buffer.from(JSON.stringify(stored, null, 2));

  await container.getBlockBlobClient(`raw/${stamp}.${opts.rawExt ?? "xlsx"}`).uploadData(rawWorkbook);
  await container.getBlockBlobClient(`parsed/${stamp}.json`).uploadData(json, {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
  // Pointer last — see module header.
  await container.getBlockBlobClient(CURRENT_POINTER).uploadData(json, {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
}

/** Read the current pointer at startup. Returns null if never uploaded (or storage isn't
 *  configured) — the caller falls back to the domain/targets.ts placeholders, same as always. */
export async function hydrateFromStorage(storageAccount: string): Promise<StoredTargets | null> {
  const container = containerClient(storageAccount);
  const blob = container.getBlockBlobClient(CURRENT_POINTER);
  if (!(await blob.exists())) return null;
  const download = await blob.downloadToBuffer();
  return JSON.parse(download.toString("utf8")) as StoredTargets;
}
