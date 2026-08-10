// Blob persistence for week snapshots. Same DefaultAzureCredential pattern as targets/blob.ts and
// the Fabric SQL pool — no new auth idiom.
//
// Layout in the `week-snapshots` container:
//   weeks/<weekStart>.json    one blob per Sat-Fri week, holding its full observation history
//
// Writes use optimistic concurrency (ETag ifMatch / ifNoneMatch) because two App Service instances
// observing the same week at the same moment would otherwise last-write-wins away one of the
// observations — and a lost observation is a movement nobody ever sees again. On a conflict the
// caller re-reads and retries; the merge is trivial because appends are content-deduped.

import { BlobServiceClient, type ContainerClient, type RestError } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { emptySnapshot, type WeekSnapshot } from "./history.js";

const CONTAINER = "week-snapshots";

let credential: DefaultAzureCredential | undefined;

function containerClient(storageAccount: string): ContainerClient {
  credential ??= new DefaultAzureCredential();
  const service = new BlobServiceClient(`https://${storageAccount}.blob.core.windows.net`, credential);
  return service.getContainerClient(CONTAINER);
}

function blobName(weekStart: string): string {
  return `weeks/${weekStart}.json`;
}

/** Azure's RestError stringifies to the bare word "RestError", which is useless in a log line — the
 *  first run of this code logged thirteen of them and said nothing about what was wrong (a missing
 *  container). Pull out the parts that identify the fault. */
export function describeError(err: unknown): string {
  const e = err as RestError & { code?: string };
  const parts = [e?.name, e?.statusCode ? `HTTP ${e.statusCode}` : null, e?.code, e?.message]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(" · ").slice(0, 300) : String(err);
}

export interface LoadedSnapshot {
  snapshot: WeekSnapshot;
  /** null when the blob does not exist yet — the write then uses ifNoneMatch to create it. */
  etag: string | null;
}

/** Create the container once per process, not once per blob operation.
 *
 *  The first run of this code failed all 13 weeks because the container did not exist and only the
 *  WRITE path created it — while the READ path ran first. Reads now ensure it too, and the promise
 *  is memoized so a pass over 13 weeks isn't 13 round trips. */
let ensured: Promise<void> | undefined;
function ensureContainer(storageAccount: string): Promise<void> {
  ensured ??= containerClient(storageAccount)
    .createIfNotExists()
    .then(() => undefined)
    .catch((err) => {
      ensured = undefined; // let a transient failure be retried on the next pass
      throw err;
    });
  return ensured;
}

/** Read a week's history. A missing blob — or a container that doesn't exist yet — is not an error:
 *  it's a week we haven't observed. */
export async function readSnapshot(storageAccount: string, weekStart: string): Promise<LoadedSnapshot> {
  await ensureContainer(storageAccount);
  const blob = containerClient(storageAccount).getBlockBlobClient(blobName(weekStart));
  // `exists()` rather than catching a 404 from download: the SDK's downloadToBuffer retries and
  // rewraps, so the statusCode isn't reliably on the error it finally throws.
  if (!(await blob.exists())) return { snapshot: emptySnapshot(weekStart), etag: null };
  try {
    const download = await blob.downloadToBuffer();
    const props = await blob.getProperties();
    return { snapshot: JSON.parse(download.toString("utf8")) as WeekSnapshot, etag: props.etag ?? null };
  } catch (err) {
    if ((err as RestError)?.statusCode === 404) return { snapshot: emptySnapshot(weekStart), etag: null };
    throw err;
  }
}

/** Conditional write. Returns false on an ETag conflict so the caller can re-read and retry —
 *  it does NOT throw, because losing a race is an ordinary outcome here, not a fault. */
export async function writeSnapshot(
  storageAccount: string,
  snapshot: WeekSnapshot,
  etag: string | null,
): Promise<boolean> {
  await ensureContainer(storageAccount);
  const blob = containerClient(storageAccount).getBlockBlobClient(blobName(snapshot.weekStart));
  const body = Buffer.from(JSON.stringify(snapshot, null, 2));
  try {
    await blob.uploadData(body, {
      blobHTTPHeaders: { blobContentType: "application/json" },
      conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
    });
    return true;
  } catch (err) {
    const status = (err as RestError)?.statusCode;
    if (status === 412 || status === 409) return false;
    throw err;
  }
}
