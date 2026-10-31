import { defineFunction } from '@aws-amplify/backend';

/**
 * Stores one batch of a device's diagnostic log.
 *
 * Its own function because the browser is the caller, guests included, and the
 * table is not something a browser should write freely. This checks the event
 * exists, validates and scrubs the batch against the shared vocabulary, applies
 * per-device, per-caller and per-event daily limits, stamps the time itself and
 * sets the expiry. Write-only on its own table plus a read of one Event row.
 */
export const recordClientLog = defineFunction({
  name: 'record-client-log',
  resourceGroupName: 'data',
  timeoutSeconds: 15,
});
