import { bodyOf, codeOnly, readSource } from './sourceGuards';

/**
 * The Lambda's copies of the survey rules.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so these
 * modules exist twice. The copies are the ones that are actually controls: the
 * page validates as a courtesy to the host, and these are the fence.
 */

const COPIES: Array<[string, string]> = [
  ['lib/survey.ts', 'amplify/functions/survey-response/survey.ts'],
  ['lib/surveyMetrics.ts', 'amplify/functions/survey-response/surveyMetrics.ts'],
  ['lib/surveyLink.ts', 'amplify/functions/survey-response/surveyLink.ts'],
];

describe('the two copies have not drifted', () => {
  it.each(COPIES)('%s matches %s below the header', (original, copy) => {
    // Hand-copied rules rot. If this fails, re-copy the lib file over the
    // function's, keeping the function copy's header.
    expect(bodyOf(readSource(copy))).toBe(bodyOf(readSource(original)));
  });
});

describe('the survey function', () => {
  const handler = readSource('amplify/functions/survey-response/handler.ts');
  const code = codeOnly(handler);

  it('compares the token in constant time', () => {
    // A plain === leaks the token a character at a time to anyone willing to
    // measure the reply.
    expect(code).toContain('timingSafeEqual');
    expect(code).not.toMatch(/surveyToken\?\.S\s*===/);
  });

  it('checks the token before branching on anything in the row', () => {
    // If a wrong token and an absent row take different paths, the endpoint
    // tells a stranger which event ids are real.
    const guard = code.indexOf('tokensMatch(row.surveyToken');
    expect(guard).toBeGreaterThan(-1);
    for (const later of ['completedAt?.S', "action === 'open'", 'cleanAnswers(']) {
      expect(code.indexOf(later)).toBeGreaterThan(guard);
    }
  });

  it('answers the same way for a bad link, a bad token and a missing row', () => {
    const refusals = code.match(/throw new Error\(REFUSED\)/g) ?? [];
    expect(refusals.length).toBeGreaterThanOrEqual(3);
  });

  it('validates every answer server-side rather than trusting the payload', () => {
    expect(code).toContain('cleanAnswers(');
    // The allow-list of attributes it is willing to write at all.
    expect(code).toContain('WRITABLE.has(id)');
  });

  it('locks a completed response at the database, not in a read-then-write', () => {
    // Two submissions in flight together must not both write.
    expect(code).toContain('attribute_not_exists(completedAt)');
  });

  it('records only the first time the survey was opened', () => {
    expect(code).toContain('if_not_exists(startedAt');
  });

  it('stamps a permission only when one was actually given', () => {
    // A timestamp beside an unanswered permission would read as a record of
    // somebody agreeing to something.
    expect(code).toContain("typeof answers.testimonialPermission === 'string'");
    expect(code).toContain("typeof answers.photoMarketingInterest === 'string'");
  });

  it('never writes to the event table', () => {
    // backend.ts grants it read only; nothing a host answers should change the
    // event the answers are about.
    expect(code).not.toMatch(/TableName:\s*EVENT_TABLE[\s\S]{0,400}UpdateExpression/);
    expect(code).not.toContain('PutItemCommand');
  });
});

describe('the backend grants', () => {
  const backend = codeOnly(readSource('amplify/backend.ts'));

  it('gives the survey function read-only access to events', () => {
    expect(backend).toContain('eventTable.grantReadData(surveyResponseFn)');
    expect(backend).not.toContain('eventTable.grantReadWriteData(surveyResponseFn)');
  });

  it('gives it the two table names it reads from the environment', () => {
    expect(backend).toContain("surveyResponseFn.addEnvironment('SURVEY_TABLE_NAME'");
    expect(backend).toContain("surveyResponseFn.addEnvironment('EVENT_TABLE_NAME'");
  });
});

describe('the survey model', () => {
  const schema = readSource('amplify/data/resource.ts');

  it('grants hosts no write on their own response', () => {
    // A browser that could write the table could grant itself permission to be
    // quoted, on somebody else's event, with a timestamp saying a person
    // agreed. The function is the only writer.
    const model = schema.slice(schema.indexOf('SurveyResponse: a'));
    const auth = model.slice(model.indexOf('.authorization'), model.indexOf('.authorization') + 220);
    expect(auth).toContain("ownerDefinedIn('customer').to(['get', 'list'])");
    expect(auth).not.toContain('update');
    expect(auth).not.toContain('create');
  });
});
