import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navbar from '@/components/Navbar';

// The router is only used to close the mobile panel on navigation, so a stub
// with an event emitter surface is enough.
const routeHandlers: Record<string, Array<() => void>> = {};
jest.mock('next/router', () => ({
  useRouter: () => ({
    replace: jest.fn(),
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

let mockUser: import('@/lib/authUser').AuthUser = { status: 'out' };
const mockSignOut = jest.fn(async () => {});
jest.mock('@/lib/authUser', () => ({
  useAuthUser: () => mockUser,
  signOutAndGoHome: () => mockSignOut(),
}));

beforeEach(() => {
  mockUser = { status: 'out' };
  mockSignOut.mockClear();
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

describe('Navbar account state', () => {
  it('shows a neutral placeholder while auth is unknown, never "Sign in"', () => {
    mockUser = { status: 'loading' };
    render(<Navbar />);
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
    expect(screen.getByTestId('auth-placeholder')).toBeInTheDocument();
  });

  it('signed out shows Sign in', () => {
    render(<Navbar />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('signed in shows the account menu with events, create and sign out', async () => {
    mockUser = { status: 'in', label: 'Seth', email: 'seth@example.com' };
    const user = userEvent.setup();
    render(<Navbar />);
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Hi, Seth/ }));
    expect(screen.getByRole('menuitem', { name: 'My events' })).toHaveAttribute('href', '/my-events');
    expect(screen.getByRole('menuitem', { name: 'Create event' })).toHaveAttribute('href', '/create-event');
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('mobile menu reflects the signed-in state too', async () => {
    mockUser = { status: 'in', label: 'My account', email: null };
    const user = userEvent.setup();
    render(<Navbar />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const panel = document.getElementById('primary-navigation')!;
    expect(panel).toHaveTextContent('Signed in');
    expect(panel).toHaveTextContent('Sign out');
    expect(panel).not.toHaveTextContent('Sign in');
  });
});
