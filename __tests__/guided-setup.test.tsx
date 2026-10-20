/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GuidedSetup from '@/components/GuidedSetup';
import HelpChat from '@/components/HelpChat';
import { GUIDE_STEPS, guideStepsFor, readGuideProgress, type GuideProgress } from '@/lib/guidedSetup';
import { jumpByKey } from '@/lib/dashboardJumps';
import { answerQuestion, wantsGuide } from '@/lib/helpChat';

const all = { commentsOn: true, featuredOffered: true };

describe('the guide steps', () => {
  it('each opens a real dashboard card', () => {
    for (const step of GUIDE_STEPS) expect(jumpByKey(step.jump)).not.toBeNull();
  });

  it('reads stored progress safely', () => {
    expect(readGuideProgress(null, 5)).toEqual({ status: 'unseen' });
    expect(readGuideProgress('nonsense', 5)).toEqual({ status: 'unseen' });
    expect(readGuideProgress('{"status":"active","step":99}', 5)).toEqual({ status: 'active', step: 4 });
    expect(readGuideProgress('{"status":"dismissed"}', 5)).toEqual({ status: 'dismissed' });
  });
});

function Harness({ onOpen }: { onOpen: (k: string) => void }) {
  const [progress, setProgress] = useState<GuideProgress>({ status: 'unseen' });
  return (
    <GuidedSetup steps={guideStepsFor(all)} progress={progress} onProgress={setProgress} onOpen={onOpen} offer />
  );
}

describe('the guide banner', () => {
  it('is offered, opens each step’s card, and can be skipped, gone back on or ended', () => {
    const opened: string[] = [];
    render(<Harness onOpen={(k) => opened.push(k)} />);
    fireEvent.click(screen.getByText('Start guided customization'));
    expect(screen.getByText(`Guided customization · 1 of ${guideStepsFor(all).length}`)).toBeTruthy();
    expect(opened).toEqual(['qr']);
    fireEvent.click(screen.getByText('Skip this one'));
    fireEvent.click(screen.getByText('Next'));
    expect(opened).toEqual(['qr', 'look', 'cover']);
    fireEvent.click(screen.getByText('Back'));
    expect(opened.at(-1)).toBe('look');
    fireEvent.click(screen.getByText('End guide'));
    expect(screen.queryByText(/Guided customization ·/)).toBeNull();
    expect(screen.queryByText('Start guided customization')).toBeNull();
  });

  it('can be turned down', () => {
    render(<Harness onOpen={() => {}} />);
    fireEvent.click(screen.getByText('Not now'));
    expect(screen.queryByText('Start guided customization')).toBeNull();
  });
});

describe('the help chat', () => {
  it('answers from the help centre and offers to take the host there', () => {
    const opened: string[] = [];
    render(<HelpChat conditions={all} onOpenJump={(k) => opened.push(k)} onStartGuide={() => {}} />);
    fireEvent.click(screen.getByText('Help'));
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'can I turn off videos' } });
    fireEvent.click(screen.getByText('Ask'));
    expect(screen.getByText('Turning video off for an event')).toBeTruthy();
    fireEvent.click(screen.getByText('Turn guest videos on or off →'));
    expect(opened).toEqual(['videos']);
  });

  it('starts the guide', () => {
    const start = jest.fn();
    render(<HelpChat conditions={all} onOpenJump={() => {}} onStartGuide={start} />);
    fireEvent.click(screen.getByText('Help'));
    fireEvent.click(screen.getByText('Start guided customization'));
    expect(start).toHaveBeenCalled();
  });

  it('says how to reach a person when it has no answer', () => {
    render(<HelpChat conditions={all} onOpenJump={() => {}} onStartGuide={() => {}} />);
    fireEvent.click(screen.getByText('Help'));
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'zxqv blorp' } });
    fireEvent.click(screen.getByText('Ask'));
    expect(screen.getByText(/a person will reply/)).toBeTruthy();
  });
});

describe('matching questions', () => {
  it('finds the right article for everyday wording', () => {
    expect(answerQuestion('how do I stop people downloading photos', all).articles[0].slug).toBe('host-guest-downloads');
    expect(answerQuestion('live slideshow on a tv', all).articles[0].slug).toBe('live-slideshow');
    expect(answerQuestion('close uploads', all).articles[0].slug).toBe('host-close-event');
    expect(answerQuestion('change the cover photo', all).jumps[0].key).toBe('cover');
  });

  it('never offers a card that is not on this event', () => {
    const none = { commentsOn: false, featuredOffered: false };
    expect(answerQuestion('review comments', none).jumps.map((j) => j.key)).not.toContain('comments');
  });

  it('notices a request for the walkthrough', () => {
    expect(wantsGuide('can you walk me through the setup')).toBe(true);
    expect(wantsGuide('turn off videos')).toBe(false);
  });
});
