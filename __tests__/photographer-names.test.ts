import { codeOnly, readSource } from './sourceGuards';

describe("the host's photographer list shows names", () => {
  const handler = codeOnly(readSource('amplify/functions/connect-photographer/handler.ts'));

  it('only for the owner of the event, or an admin', () => {
    expect(handler).toMatch(/owner\.split\('::'\)\[0\] !== sub && !groups\.includes\('ADMINS'\)\)\) throw new Error\(DENIED\)/);
  });

  it('only for photographers actually connected to that event', () => {
    expect(handler).toContain('Keys: asked.map((id) => ({ id: { S: connectionId(eventId, id) } }))');
  });

  it('returns the business name and nothing else from the profile', () => {
    expect(handler).toContain("ProjectionExpression: 'id, businessName, displayName'");
  });

  it('is shown on the Manage page', () => {
    const admin = readSource('pages/event/[eventId]/admin.tsx');
    expect(admin).toContain("row.name ?? 'Photographer (no business name set yet)'");
  });
});
