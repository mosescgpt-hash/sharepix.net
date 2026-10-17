import { defineFunction } from '@aws-amplify/backend';

/**
 * Booth mode for the photographer (docs/booth-mode.md): record a scanned
 * attendee code, store the camera clock offset, and report who is being shot
 * now and who each photo was matched to. Backs boothScan, setBoothClock and
 * boothStatus.
 */
export const boothScan = defineFunction({
  name: 'booth-scan',
  resourceGroupName: 'data',
});
