import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from '@/components/Navbar';

// The router is only used to close the mobile panel on navigation, so a stub
// with an event emitter surface is enough.
const routeHandlers: Record<string, Array<() => void>> = {};
jest.mock('next/router', () => ({
  useRouter: () => ({
    events: {
      on: (event: string, handler: () => void) => {
        routeHandlers[event] = [...(routeHandlers[event] ?? []), handler];
      },
      off: (event: string, handler: () => void) => {
        routeHandlers[event] = (routeHandlers[event] ?? []).filter((h) => h !== handler);
      },
    },
  }),
}));

beforeEach(() => {
  for (const key of Object.keys(routeHandlers)) delete routeHandlers[key];
});

describe('Navbar mobile menu', () => {
  it('starts closed', () => {
    render(<Navbar />);
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens on tap and reports it to assistive technology', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const toggle = screen.getByRole('button', { name: 'Close menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('primary-navigation')).toBeInTheDocument();
  });

  // The bug this guards: the panel used to stay open across a client-side
  // navigation, covering the page the visitor had just asked for.
  it('closes itself when the route changes', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(document.getElementById('primary-navigation')).toBeInTheDocument();

    // Fired outside React's event system, so the re-render has to be awaited
    // explicitly — without act() the assertion runs against the old tree.
    act(() => {
      for (const handler of routeHandlers.routeChangeComplete ?? []) handler();
    });

    expect(document.getElementById('primary-navigation')).not.toBeInTheDocument();
  });
});
