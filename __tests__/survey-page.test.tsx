import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SurveyPage from '@/pages/survey/[link]';
import type { SurveyState } from '@/lib/api';

// The page reads query.link; Layout's Navbar subscribes to route events, so
// the stub needs both.
jest.mock('next/router', () => ({
  useRouter: () => ({
    query: { link: 'a-link' },
    events: { on: () => undefined, off: () => undefined },
  }),
}));

const surveyAction = jest.fn();
jest.mock('@/lib/api', () => ({
  surveyAction: (...args: unknown[]) => surveyAction(...args),
}));

function state(overrides: Partial<SurveyState> = {}): SurveyState {
  return {
    ok: true,
    completed: false,
    message: '',
    eventName: 'Sam and Ada',
    surveyVersion: 'v1.0',
    answers: {},
    eventType: null,
    ...overrides,
  };
}

beforeEach(() => {
  surveyAction.mockReset();
  surveyAction.mockResolvedValue(state());
  window.scrollTo = jest.fn();
});

/** Open the survey and wait for the first step to render. */
async function open() {
  render(<SurveyPage />);
  await screen.findByText(/your feedback\./i);
}

describe('opening the survey', () => {
  it('asks the server to open it, once', async () => {
    await open();
    expect(surveyAction).toHaveBeenCalledWith('a-link', 'open');
  });

  it('greets the host by their event', async () => {
    await open();
    expect(screen.getByText(/Sam and Ada/)).toBeInTheDocument();
  });

  it('says nothing is required and that answers save as they go', async () => {
    // The length is what stops people finishing; saying this up front is the
    // main thing that keeps a partial answer from feeling pointless.
    await open();
    expect(screen.getByText(/Nothing here is required/i)).toBeInTheDocument();
  });

  it('starts at one of five', async () => {
    await open();
    expect(screen.getByText('1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5');
  });

  it('shows a plain message for a link that does not work', async () => {
    surveyAction.mockResolvedValue(
      state({ ok: false, message: 'That link is not valid. It may have expired.' }),
    );
    render(<SurveyPage />);
    expect(await screen.findByText(/didn.t work/i)).toBeInTheDocument();
    expect(screen.getByText(/not valid/i)).toBeInTheDocument();
  });

  it('shows the thank-you, not the questions, for a survey already sent', async () => {
    surveyAction.mockResolvedValue(state({ completed: true, message: 'Already in.' }));
    render(<SurveyPage />);
    expect(await screen.findByText(/Thank you\./)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('resuming', () => {
  it('brings back answers already stored', async () => {
    surveyAction.mockResolvedValue(state({ answers: { eventType: 'birthday' } }));
    await open();
    expect(screen.getByRole('radio', { name: 'Birthday' })).toBeChecked();
  });

  it('pre-selects the event type SharePix already knows', async () => {
    surveyAction.mockResolvedValue(state({ eventType: 'wedding' }));
    await open();
    expect(screen.getByRole('radio', { name: 'Wedding' })).toBeChecked();
  });

  it('never overwrites an answer the host already gave', async () => {
    // The event row says wedding; they said graduation. Theirs wins.
    surveyAction.mockResolvedValue(
      state({ eventType: 'wedding', answers: { eventType: 'graduation' } }),
    );
    await open();
    expect(screen.getByRole('radio', { name: 'Graduation' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Wedding' })).not.toBeChecked();
  });
});

describe('answering', () => {
  it('records a choice', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: 'Wedding' }));
    expect(screen.getByRole('radio', { name: 'Wedding' })).toBeChecked();
  });

  it('lets a scale be answered by its number', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: '4 out of 5' }));
    expect(screen.getByRole('radio', { name: '4 out of 5' })).toBeChecked();
  });

  it('reveals a text box when Other is chosen', async () => {
    const user = userEvent.setup();
    await open();
    expect(screen.queryByLabelText(/tell us which/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /something else/i }));
    expect(screen.getByLabelText(/tell us which/i)).toBeInTheDocument();
  });

  it('reads each question out with its options', async () => {
    // A radio group is a fieldset with the prompt as its legend, so the
    // question is announced with each option rather than left to visual
    // proximity.
    await open();
    expect(
      screen.getByRole('group', { name: /what kind of event/i }),
    ).toBeInTheDocument();
  });
});

describe('moving between steps', () => {
  it('cannot go back from the first step', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('saves what has been answered before moving on', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: 'Wedding' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(surveyAction).toHaveBeenCalledWith(
        'a-link',
        'save',
        expect.objectContaining({ eventType: 'wedding' }),
      ),
    );
  });

  it('advances the progress indicator', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('2 of 5')).toBeInTheDocument();
  });

  it('offers the send button only on the last step', async () => {
    const user = userEvent.setup();
    await open();
    expect(screen.queryByRole('button', { name: /send my feedback/i })).not.toBeInTheDocument();
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    expect(await screen.findByText('5 of 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send my feedback/i })).toBeInTheDocument();
  });
});

describe('the conditional question', () => {
  async function goToGuestSection(user: ReturnType<typeof userEvent.setup>) {
    await open();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('2 of 5');
  }

  it('stays hidden until somebody says a guest needed help', async () => {
    const user = userEvent.setup();
    await goToGuestSection(user);
    expect(screen.queryByText(/what were they stuck on/i)).not.toBeInTheDocument();
  });

  it('stays hidden when the answer is No', async () => {
    const user = userEvent.setup();
    await goToGuestSection(user);
    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.queryByText(/what were they stuck on/i)).not.toBeInTheDocument();
  });

  it('appears once a guest did need help', async () => {
    const user = userEvent.setup();
    await goToGuestSection(user);
    await user.click(screen.getByRole('radio', { name: /yes, several/i }));
    expect(screen.getByText(/what were they stuck on/i)).toBeInTheDocument();
  });
});

describe('submitting', () => {
  async function goToLastStep(user: ReturnType<typeof userEvent.setup>) {
    await open();
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    await screen.findByText('5 of 5');
  }

  it('sends the answers and shows the thank-you', async () => {
    const user = userEvent.setup();
    await goToLastStep(user);
    surveyAction.mockResolvedValue(state({ completed: true }));

    await user.click(screen.getByRole('button', { name: /send my feedback/i }));

    await waitFor(() =>
      expect(surveyAction).toHaveBeenCalledWith('a-link', 'submit', expect.any(Object)),
    );
    expect(await screen.findByText(/exactly what we needed/i)).toBeInTheDocument();
  });

  it('keeps the permission questions on their own step, away from the product ones', async () => {
    // A permission asked alongside "how satisfied are you" reads as a
    // condition of being heard.
    const user = userEvent.setup();
    await goToLastStep(user);
    expect(screen.getByText(/may we quote what you have written/i)).toBeInTheDocument();
    expect(screen.queryByText(/how satisfied are you/i)).not.toBeInTheDocument();
    expect(screen.getByText(/none of them change anything/i)).toBeInTheDocument();
  });

  it('describes the photo question as a conversation, not a grant', async () => {
    // Answering yes permits us to ask. It permits nothing about anybody's
    // photographs, and the people in them did not answer this survey.
    const user = userEvent.setup();
    await goToLastStep(user);
    expect(screen.getByText(/talking with us separately/i)).toBeInTheDocument();
  });
});
