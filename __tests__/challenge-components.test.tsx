import { fireEvent, render, screen } from '@testing-library/react';
import ChallengeCard from '@/components/challenges/ChallengeCard';
import ChallengeChips from '@/components/challenges/ChallengeChips';
import type { EventChallenge } from '@/lib/challenges/api';

const c = (id: string, text: string, active = true, order = 0): EventChallenge => ({
  id,
  eventId: 'ev1',
  text,
  order,
  active,
  createdAt: null,
});
const challenges = [c('a', 'A toast', true, 1), c('b', 'Shoes off', true, 2), c('z', 'Retired', false, 3)];

describe('ChallengeCard', () => {
  it('renders nothing when the event has no active challenges', () => {
    const { container } = render(
      <ChallengeCard challenges={[c('z', 'Retired', false)]} selected={null} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one active prompt and shuffles to a different one', () => {
    render(<ChallengeCard challenges={challenges} selected={null} onSelect={() => {}} />);
    const first = screen.getByText(/A toast|Shoes off/).textContent;
    expect(screen.queryByText('Retired')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Another one' }));
    expect(screen.getByText(/A toast|Shoes off/).textContent).not.toBe(first);
  });

  it('attaches the prompt and opens the camera on "Take this photo"', () => {
    const camera = document.createElement('input');
    camera.id = 'photo-camera-input';
    const click = jest.spyOn(camera, 'click').mockImplementation(() => {});
    document.body.appendChild(camera);
    const onSelect = jest.fn();
    render(<ChallengeCard challenges={challenges} selected={null} onSelect={onSelect} />);
    const shown = screen.getByText(/A toast|Shoes off/).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Take this photo' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ text: shown }));
    expect(click).toHaveBeenCalled();
    camera.remove();
  });

  it('lets the guest drop the challenge in one tap', () => {
    const onSelect = jest.fn();
    render(<ChallengeCard challenges={challenges} selected={challenges[0]} onSelect={onSelect} />);
    expect(screen.getByText('Your challenge')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload without a challenge' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('ChallengeChips', () => {
  it('is hidden until a photo answers a challenge', () => {
    const { container } = render(
      <ChallengeChips challenges={challenges} photos={[{}, { challengeId: null }]} selectedId={null} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows All plus a chip per challenge with photos, and reports the pick', () => {
    const onSelect = jest.fn();
    render(
      <ChallengeChips
        challenges={challenges}
        photos={[{ challengeId: 'b' }, { challengeId: 'b' }, { challengeId: 'z' }]}
        selectedId={null}
        onSelect={onSelect}
      />,
    );
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['All', 'Shoes off 2', 'Retired 1']);
    fireEvent.click(screen.getByRole('button', { name: /Shoes off/ }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});
