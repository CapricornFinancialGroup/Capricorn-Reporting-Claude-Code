// Blob persistence for office placements made on the Offices admin page. Same storage account and the
// same DefaultAzureCredential pattern as the weekly targets (services/targets/blob.ts).
//
// Layout in the `adviser-offices` container:
//   history/<timestamp>.json  every saved state, in full (audit: who placed whom, and when)
//   current.json              pointer blob, written LAST, so a failed save never leaves it half-written

import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import type { OfficeAssignment } from "../../domain/offices.js";

const CONTAINER = "adviser-offices";
const CURRENT_POINTER = "current.json";

export interface StoredOffices {
  /** login (lower-cased) → placement. The whole override layer, not a delta. */
  assignments: Record<string, OfficeAssignment>;
  updatedBy: string;
  updatedAt: string;
}

let credential: DefaultAzureCredential | undefined;

function containerClient(storageAccount: string): ContainerClient {
  credential ??= new DefaultAzureCredential();
  const service = new BlobServiceClient(`https://${storageAccount}.blob.core.windows.net`, credential);
  return service.getContainerClient(CONTAINER);
}

/** Persist the full override layer, history first and pointer last. Call BEFORE activating in memory,
 *  so a failed write can never leave the page claiming a placement that a restart would lose. */
export async function saveOfficesBlob(storageAccount: string, stored: StoredOffices): Promise<void> {
  const container = containerClient(storageAccount);
  await container.createIfNotExists();
  const json = Buffer.from(JSON.stringify(stored, null, 2));
  const headers = { blobHTTPHeaders: { blobContentType: "application/json" } };
  await container.getBlockBlobClient(`history/${stored.updatedAt.replace(/[:.]/g, "-")}.json`).uploadData(json, headers);
  await container.getBlockBlobClient(CURRENT_POINTER).uploadData(json, headers);
}

/** The saved placements, or null if none have ever been made. */
export async function loadOfficesBlob(storageAccount: string): Promise<StoredOffices | null> {
  const blob = containerClient(storageAccount).getBlockBlobClient(CURRENT_POINTER);
  if (!(await blob.exists())) return null;
  return JSON.parse((await blob.downloadToBuffer()).toString("utf8")) as StoredOffices;
}
