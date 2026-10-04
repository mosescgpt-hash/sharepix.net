/**
 * Browser calls for photo challenges. The functions behind them re-check
 * every rule; these only carry the request.
 */
import { authModeFor, getClient } from '../dataClient';

export interface EventChallenge {
  id: string;
  eventId: string;
  text: string;
  order: number;
  active: boolean;
  createdAt: string | null;
}

export interface ChallengeReply {
  ok: boolean;
  message: string;
  challenge: EventChallenge | null;
}

const FAILED: ChallengeReply = { ok: false, message: 'Something went wrong. Try again in a moment.', challenge: null };

function toChallenge(c: Record<string, unknown> | null | undefined): EventChallenge | null {
  if (!c || typeof c.id !== 'string') return null;
  return {
    id: c.id,
    eventId: String(c.eventId ?? ''),
    text: String(c.text ?? ''),
    order: typeof c.order === 'number' ? c.order : 0,
    active: c.active !== false,
    createdAt: typeof c.createdAt === 'string' ? c.createdAt : null,
  };
}

type RawReply = { ok?: boolean | null; message?: string | null; challenge?: unknown } | null | undefined;

function reply(data: RawReply, errors: unknown[] | undefined): ChallengeReply {
  if (errors?.length || !data) return FAILED;
  return {
    ok: data.ok === true,
    message: data.message ?? '',
    challenge: toChallenge(data.challenge as Record<string, unknown> | null),
  };
}

/**
 * One event's challenges. Guests get [] when the switch is off; the host gets
 * every one. Never throws: challenges are decoration and must not break a page.
 */
export async function fetchEventChallenges(eventId: string): Promise<EventChallenge[]> {
  try {
    const { data, errors } = await getClient().queries.eventChallenges(
      { eventId },
      { authMode: await authModeFor() },
    );
    if (errors?.length) return [];
    return (data ?? []).map((c) => toChallenge(c as Record<string, unknown>)).filter((c): c is EventChallenge => !!c);
  } catch {
    return [];
  }
}

export async function saveChallenge(input: {
  eventId: string;
  challengeId?: string | null;
  text: string;
  order: number;
  active: boolean;
}): Promise<ChallengeReply> {
  try {
    const { data, errors } = await getClient().mutations.saveChallenge(
      { ...input, challengeId: input.challengeId || undefined },
      { authMode: 'userPool' },
    );
    return reply(data as RawReply, errors);
  } catch {
    return FAILED;
  }
}

export async function removeChallenge(eventId: string, challengeId: string): Promise<ChallengeReply> {
  try {
    const { data, errors } = await getClient().mutations.removeChallenge({ eventId, challengeId }, { authMode: 'userPool' });
    return reply(data as RawReply, errors);
  } catch {
    return FAILED;
  }
}

export async function setChallengeSettings(
  eventId: string,
  settings: { enabled?: boolean; captions?: boolean },
): Promise<ChallengeReply> {
  try {
    const { data, errors } = await getClient().mutations.setChallengeSettings(
      { eventId, ...settings },
      { authMode: 'userPool' },
    );
    return reply(data as RawReply, errors);
  } catch {
    return FAILED;
  }
}
