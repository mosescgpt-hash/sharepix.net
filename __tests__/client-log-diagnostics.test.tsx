import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DiagnosticsPanel from '@/components/DiagnosticsPanel';
import LogNotice from '@/components/LogNotice';
import LogOptOut from '@/components/LogOptOut';
import PrivacyPage from '@/pages/privacy';
import {
  buildTimeline,
  deviceLabel,
  parseDiagnostics,
  summarizeDevices,
  timelineToCsv,
  type DiagnosticRow,
} from '@/lib/diagnostics';
import { isLoggingOff, resetClientLogForTests } from '@/lib/clientLog';

const mockQuery = jest.fn();
jest.mock('@/lib/dataClient', () => ({
  authModeFor: async () => 'userPool',
  getClient: () => ({ queries: { eventDiagnostics: (...args: unknown[]) => mockQuery(...args) } }),
}));
// The page is the subject, not the site chrome around it.
jest.mock('@/components/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn() }));

const A = 'ABCDEFGHJKMNPQRSTVWX';
const B = 'WXVTSRQPNMKJHGFEDCBA';

const rows: DiagnosticRow[] = [
  {
    id: '1',
    receivedAt: '2026-10-31T15:00:10.000Z',
    deviceId: A,
    sessionId: 's1',
    build: 'abc1234',
    device: { b: 'Safari 17', os: 'iOS 17', app: 'Facebook', w: 390, h: 844 },
    entries: [
      { t: 9000, c: 'route_view', r: '/event/:id/upload', at: '2026-10-31T15:00:01.000Z' },
      { t: 1000, c: 'upload_fail', d: 'network', n: 4200, at: '2026-10-31T15:00:09.000Z' },
    ],
  },
  {
    id: '2',
    receivedAt: '2026-10-31T15:05:00.000Z',
    deviceId: B,
    sessionId: 's2',
    build: 'abc1234',
    device: { b: 'Chrome 120', os: 'Android 14' },
    entries: [{ t: 0, c: 'live_start', d: '=cmd|calc', at: '2026-10-31T15:05:00.000Z' }],
  },
];

describe('diagnostics helpers', () => {
  it('reads what the function returned and tolerates junk', () => {
    expect(parseDiagnostics(JSON.stringify({ rows, nextToken: 'n' })).nextToken).toBe('n');
    expect(parseDiagnostics('not json')).toEqual({ rows: [], nextToken: null });
    expect(parseDiagnostics(null)).toEqual({ rows: [], nextToken: null });
    expect(parseDiagnostics(JSON.stringify({ rows: [{ id: 'x' }] })).rows[0].entries).toEqual([]);
  });

  it('names a device the way a host would', () => {
    expect(deviceLabel(rows[0].device)).toBe('Facebook · Safari 17 · iOS 17 (390×844)');
    expect(deviceLabel(null)).toBe('Unknown device');
  });

  it('lists the device with problems first, with its support code', () => {
    const [first, second] = summarizeDevices(rows);
    expect(first.code).toBe('ABCD-EFGH');
    expect(first.problemCount).toBe(1);
    expect(second.problemCount).toBe(0);
  });

  it('orders a timeline oldest first and can narrow it to one device', () => {
    expect(buildTimeline(rows).map((i) => i.c)).toEqual(['route_view', 'upload_fail', 'live_start']);
    expect(buildTimeline(rows, B).map((i) => i.c)).toEqual(['live_start']);
  });

  it('exports CSV that a spreadsheet will not run as a formula', () => {
    const csv = timelineToCsv(buildTimeline(rows));
    expect(csv.split('\n')[0]).toBe('time,support_code,session,event,level,route,detail,number');
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain('upload_fail,error');
  });
});

describe('DiagnosticsPanel', () => {
  beforeEach(() => mockQuery.mockReset());

  it('reads nothing until the host asks', () => {
    render(<DiagnosticsPanel eventId="evt-12345678" eventName="Horse Show" />);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(screen.getByText(/no photos, names or messages/i)).toBeInTheDocument();
  });

  it('shows devices and a timeline, and narrows to one device', async () => {
    mockQuery.mockResolvedValue({ data: JSON.stringify({ rows, nextToken: null }) });
    render(<DiagnosticsPanel eventId="evt-12345678" eventName="Horse Show" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show logs' }));
    const devices = await screen.findByRole('list', { name: 'Devices' });
    expect(within(devices).getByText('ABCD-EFGH')).toBeInTheDocument();
    expect(mockQuery.mock.calls[0][0]).toMatchObject({ scope: 'event', eventId: 'evt-12345678' });

    const timeline = screen.getByLabelText('Timeline');
    expect(within(timeline).getAllByText(/upload_fail/)).toHaveLength(1);
    expect(within(timeline).getByText(/live_start/)).toBeInTheDocument();

    await userEvent.click(within(devices).getByText('ABCD-EFGH'));
    expect(within(timeline).queryByText(/live_start/)).toBeNull();
  });

  it('sends a typed support code, cleaned up', async () => {
    mockQuery.mockResolvedValue({ data: JSON.stringify({ rows: [], nextToken: null }) });
    render(<DiagnosticsPanel eventId="evt-12345678" eventName="Horse Show" />);
    await userEvent.type(screen.getByPlaceholderText('ABCD-EFGH'), 'abcd-efgh');
    await userEvent.click(screen.getByRole('button', { name: 'Show logs' }));
    await waitFor(() => expect(mockQuery).toHaveBeenCalled());
    expect(mockQuery.mock.calls[0][0].deviceCode).toBe('ABCDEFGH');
    expect(await screen.findByText(/No logs yet for that code/)).toBeInTheDocument();
  });

  it('says so when the read fails', async () => {
    mockQuery.mockRejectedValue(new Error('boom'));
    render(<DiagnosticsPanel eventId="evt-12345678" eventName="Horse Show" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show logs' }));
    expect(await screen.findByText(/could not load the logs/)).toBeInTheDocument();
  });
});

describe('guest notice and opt-out', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetClientLogForTests();
  });

  it('tells a guest what is kept, for how long, and shows their support code', async () => {
    render(<LogNotice />);
    const notice = await screen.findByTestId('log-notice');
    expect(notice).toHaveTextContent(/never your photos, name or messages/);
    expect(notice).toHaveTextContent('60 days');
    expect(notice.querySelector('strong')?.textContent).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy#diagnostic-logs');
  });

  it('turns logging off in one tap, and back on', async () => {
    render(<LogNotice />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(isLoggingOff()).toBe(true);
    expect(screen.getByTestId('log-notice')).toHaveTextContent(/logs are off on this device/i);
    expect(screen.queryByText(/Support code/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Turn logs on' }));
    expect(isLoggingOff()).toBe(false);
  });

  it('gives the privacy page the same switch', async () => {
    render(<LogOptOut />);
    expect(await screen.findByTestId('log-opt-out')).toHaveTextContent(/logs are on/);
    await userEvent.click(screen.getByRole('button', { name: /Turn them off/ }));
    expect(isLoggingOff()).toBe(true);
  });
});

describe('privacy page', () => {
  it('describes the diagnostic logs, what they exclude, how long they are kept and the opt-out', async () => {
    render(<PrivacyPage />);
    const heading = screen.getByRole('heading', { name: 'Diagnostic logs' });
    expect(heading).toHaveAttribute('id', 'diagnostic-logs');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/never contain/);
    expect(text).toMatch(/kept\s+for 60 days/);
    expect(text).toMatch(/Do Not Track/);
    expect(text).toMatch(/Cloudflare Web Analytics\s+only/);
    expect(await screen.findByTestId('log-opt-out')).toBeInTheDocument();
  });
});
