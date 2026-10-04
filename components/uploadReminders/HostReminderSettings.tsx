import { useEffect, useMemo, useState } from 'react';
import { setUploadReminders } from '@/lib/uploadReminders/api';
import { isValidTimeZone, reminderSchedule, zoneFor } from '@/lib/uploadReminders/rules';
import { COMMON_TIME_ZONES, allTimeZones, browserTimeZone } from '@/lib/uploadReminders/timeZones';
import type { QREvent } from '@/lib/types';

/**
 * The dashboard switch for guest upload reminders, and the event's time zone.
 *
 * The host never sees who opted in or their addresses — only that it is on.
 */
export default function HostReminderSettings({
  event,
  onSaved,
}: {
  event: QREvent;
  onSaved?: () => void;
}) {
  const [enabled, setEnabled] = useState(event.uploadRemindersEnabled === true);
  const [timeZone, setTimeZone] = useState(
    isValidTimeZone(event.timeZone) ? event.timeZone : 'America/Chicago',
  );
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // A host who never chose gets their own browser's zone preselected.
  useEffect(() => {
    if (!isValidTimeZone(event.timeZone)) setTimeZone(browserTimeZone());
  }, [event.timeZone]);

  const otherZones = useMemo(() => {
    const common = new Set(COMMON_TIME_ZONES.map((z) => z.value));
    return allTimeZones().filter((z) => !common.has(z));
  }, []);

  const preview = reminderSchedule({ ...event, timeZone }, Date.now());
  const fmt = (d: Date) =>
    d.toLocaleString('en-US', {
      timeZone: zoneFor({ timeZone }),
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const save = async (nextEnabled: boolean, nextZone: string) => {
    setSaving(true);
    setNote(null);
    const result = await setUploadReminders(event.id, nextEnabled, nextZone);
    setSaving(false);
    setNote({ ok: result.ok, text: result.message });
    if (result.ok) {
      setEnabled(nextEnabled);
      onSaved?.();
    }
  };

  return (
    <div className="spx-card mt-6 p-6">
      <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Guest reminders</h2>
      <p className="mt-1 text-sm text-charcoal/60">
        After a guest&apos;s first upload, offer to email them a reminder to add more. You never
        see their address, and we delete it 30 days after uploads close.
      </p>

      <label className="mt-4 flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => save(e.target.checked, timeZone)}
          className="h-5 w-5"
        />
        <span className="text-sm font-medium">Offer guests a reminder</span>
      </label>

      <label htmlFor="reminder-zone" className="mt-4 block text-sm font-medium">
        Event time zone
      </label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <select
          id="reminder-zone"
          value={timeZone}
          disabled={saving}
          onChange={(e) => {
            setTimeZone(e.target.value);
            if (enabled) save(true, e.target.value);
          }}
          className="spx-input min-w-0 flex-1"
        >
          <optgroup label="United States">
            {COMMON_TIME_ZONES.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Everywhere else">
            {otherZones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <ul className="mt-4 space-y-1 text-sm text-charcoal/70">
        <li>
          Reminder 1:{' '}
          {preview.first
            ? fmt(preview.first)
            : 'needs an event date (the morning after the event).'}
        </li>
        <li>
          Reminder 2:{' '}
          {preview.second
            ? `${fmt(preview.second)}, three days before uploads close.`
            : 'none (only sent when uploads stay open more than a week).'}
        </li>
        {preview.closesAt ? (
          <li>
            Uploads close:{' '}
            {preview.closesAt.toLocaleDateString('en-US', {
              timeZone: zoneFor({ timeZone }),
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
            .
          </li>
        ) : null}
      </ul>

      {note ? (
        <p className={`mt-3 text-sm ${note.ok ? 'text-green-700' : 'text-red-700'}`} role="status">
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
