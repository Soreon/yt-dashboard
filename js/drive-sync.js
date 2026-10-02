// Google Drive sync: the devices meet in one file of the app's hidden Drive folder. Each sync
// reads the file if another device changed it, merges it with the local data (sync-model.js),
// and writes the result back if it holds anything the file does not

import { createSyncFile, downloadFile, findSyncFile, getFileVersion, uploadFile } from './drive.js';
import { getDriveSyncState, getSyncedReplica, saveDriveSyncState, saveSyncedReplica } from './storage.js';
import { fromSyncFile, mergeReplicas, sameReplica, toSyncFile } from './sync-model.js';

let running = null; // Promise of the sync in progress
let pending = false; // Asked again while running: sync once more right after

// Sync now (or right after the one in progress). Resolves to { changed }: whether the local data
// changed, so the page needs rendering again
export function syncWithDrive(token) {
    if (running) {
        pending = true;
        return running;
    }

    running = (async () => {
        let changed = false;
        do {
            pending = false;
            changed = (await syncOnce(token)) || changed;
        } while (pending);
        return { changed };
    })().finally(() => {
        running = null;
    });
    return running;
}

async function syncOnce(token) {
    const state = getDriveSyncState();

    // The file: the one used last time, unless it was deleted (from the Drive settings)
    let fileId = state.fileId || null;
    let version = fileId ? await getFileVersion(fileId, token) : null;
    if (version === null) {
        const found = await findSyncFile(token);
        fileId = found?.id || null;
        version = found?.version ?? null;
    }

    // Another device wrote since the last sync: read its version of the data. An empty file (its
    // first upload failed) has nothing to read, and needs one
    let remote = null;
    let empty = !fileId;
    if (fileId && version !== state.version) {
        const content = await downloadFile(fileId, token);
        if (content === null) {
            empty = true;
        } else {
            remote = fromSyncFile(content);
        }
    }

    // Read, merge and save the local data in one go, so that no change made meanwhile is lost
    const local = getSyncedReplica();
    const merged = remote ? mergeReplicas(local, remote) : local;
    const changed = Boolean(remote) && !sameReplica(merged, local);
    if (changed) saveSyncedReplica(merged);

    // Send it if the file lacks something: no file or an empty one, a merge that adds to it, or
    // local changes since the last upload (each one raised the latest stamp)
    const upload = empty || (remote ? !sameReplica(merged, remote) : merged.stamps.last > (state.uploadedLast ?? -1));
    if (upload) {
        if (!fileId) fileId = await createSyncFile(token);
        version = await uploadFile(fileId, toSyncFile(merged, Date.now()), token);
    }

    saveDriveSyncState({ ...getDriveSyncState(), fileId, version, uploadedLast: merged.stamps.last, syncedAt: Date.now() });
    return changed;
}
