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
    // Once in the desktop nav and once in the phone bar.
    const links = screen.getAllByRole('link', { name: 'Sign in' });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) expect(link).toHaveAttribute('href', '/sign-in');
  });

  describe('phone header', () => {
    it('menu button is a column of three visible navy bars, at least 44px to tap', () => {
      render(<Navbar />);
      const button = screen.getByTestId('menu-button');
      expect(button.className).toContain('flex-col');
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('min-w-[44px]');
      const bars = button.querySelectorAll('span');
      expect(bars).toHaveLength(3);
      for (const bar of Array.from(bars)) {
        expect(bar.className).toContain('bg-ink');
        expect(bar.className).toContain('h-0.5');
        expect(bar.className).not.toContain('h-px');
      }
    });

    it('shows Sign in in the bar when signed out', () => {
      render(<Navbar />);
      const link = screen.getByTestId('mobile-auth-link');
      expect(link).toHaveTextContent('Sign in');
      expect(link).toHaveAttribute('href', '/sign-in');
      expect(link.className).toContain('min-h-[44px]');
      expect(link.className).toContain('text-ink');
    });

    it('shows My events in the bar when signed in', () => {
      mockUser = { status: 'in', label: 'Seth', email: null };
      render(<Navbar />);
      const link = screen.getByTestId('mobile-auth-link');
      expect(link).toHaveTextContent('My events');
      expect(link).toHaveAttribute('href', '/my-events');
    });

    it('shows neither while auth is unknown', () => {
      mockUser = { status: 'loading' };
      render(<Navbar />);
      expect(screen.queryByTestId('mobile-auth-link')).not.toBeInTheDocument();
    });
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
