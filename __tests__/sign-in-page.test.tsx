import { render, screen } from '@testing-library/react';

let mockUser: import('@/lib/authUser').AuthUser = { status: 'loading' };
jest.mock('@/lib/authUser', () => ({ useAuthUser: () => mockUser, signOutAndGoHome: jest.fn() }));
jest.mock('next/router', () => ({ useRouter: () => ({ replace: jest.fn(), events: { on() {}, off() {} } }) }));
jest.mock('@/components/hostAuth', () => ({ withHostAuth: () => () => <p>SIGN-IN FORM</p> }));
jest.mock('@/components/Layout', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import SignInPage from '@/pages/sign-in';

describe('/sign-in', () => {
  it('shows no form while checking', () => {
    mockUser = { status: 'loading' };
    render(<SignInPage />);
    expect(screen.queryByText('SIGN-IN FORM')).not.toBeInTheDocument();
  });
  it('signed out gets the form', () => {
    mockUser = { status: 'out' };
    render(<SignInPage />);
    expect(screen.getByText('SIGN-IN FORM')).toBeInTheDocument();
  });
  it('signed in sees who they are, not a form', () => {
    mockUser = { status: 'in', label: 'Seth', email: 'seth@example.com' };
    render(<SignInPage />);
    expect(screen.getByRole('heading')).toHaveTextContent("You're signed in as seth@example.com");
    expect(screen.getByRole('link', { name: 'Go to my events' })).toHaveAttribute('href', '/my-events');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText('SIGN-IN FORM')).not.toBeInTheDocument();
  });
});
