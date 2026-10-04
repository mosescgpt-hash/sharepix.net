/**
 * Browser calls for guest upload reminders. Every rule is re-checked by the
 * function behind each mutation; these only carry the request.
 */
import { authModeFor, getClient } from '../dataClient';

export interface ReminderReply {
  ok: boolean;
  message: string;
}

const FAILED: ReminderReply = { ok: false, message: 'Something went wrong. Try again in a moment.' };

function reply(data: { ok?: boolean | null; message?: string | null } | null | undefined): ReminderReply {
  return data ? { ok: data.ok === true, message: data.message ?? '' } : FAILED;
}

/** A guest asks for a reminder. Works signed out. */
export async function requestUploadReminder(eventId: string, email: string): Promise<ReminderReply> {
  try {
    const { data, errors } = await getClient().mutations.requestUploadReminder(
      { eventId, email },
      { authMode: await authModeFor() },
    );
    return errors?.length ? FAILED : reply(data);
  } catch {
    return FAILED;
  }
}

/** The unsubscribe link. Works signed out. */
export async function stopUploadReminders(id: string, token: string): Promise<ReminderReply> {
  try {
    const { data, errors } = await getClient().mutations.stopUploadReminders(
      { id, token },
      { authMode: await authModeFor() },
    );
    return errors?.length ? FAILED : reply(data);
  } catch {
    return FAILED;
  }
}

/** The host's switch and time zone. */
export async function setUploadReminders(
  eventId: string,
  enabled: boolean,
  timeZone: string,
): Promise<ReminderReply> {
  try {
    const { data, errors } = await getClient().mutations.setUploadReminders(
      { eventId, enabled, timeZone },
      { authMode: 'userPool' },
    );
    return errors?.length ? FAILED : reply(data);
  } catch {
    return FAILED;
  }
}

/** Admin: run the hourly job now, or with `probe` only ask whether sending is on. */
export async function runUploadReminders(
  probe = false,
): Promise<{ ok: boolean; dryRun: boolean; summary: string }> {
  const { data, errors } = await getClient().mutations.runUploadReminders(
    { probe },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return { ok: data?.ok ?? false, dryRun: data?.dryRun ?? true, summary: data?.summary ?? '' };
}
