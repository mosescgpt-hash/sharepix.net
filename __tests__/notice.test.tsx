import { render, screen } from '@testing-library/react';
import Notice from '@/components/Notice';

describe('Notice', () => {
  it('renders its message', () => {
    render(<Notice>Uploads have closed.</Notice>);
    expect(screen.getByText('Uploads have closed.')).toBeInTheDocument();
  });

  // The distinction that matters for accessibility: something has gone wrong
  // mid-flow and must interrupt, versus an incidental note that must not.
  it('announces errors and warnings', () => {
    const { unmount } = render(<Notice tone="error">Upload failed.</Notice>);
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed.');
    unmount();

    render(<Notice tone="warn">Nearly out of room.</Notice>);
    expect(screen.getByRole('alert')).toHaveTextContent('Nearly out of room.');
  });

  it('does not announce info or success', () => {
    const { unmount } = render(<Notice>Print order cancelled.</Notice>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    render(<Notice tone="success">Order confirmed.</Notice>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('labels a tone by default and lets a caller override or drop the label', () => {
    const { unmount } = render(<Notice tone="error">Boom.</Notice>);
    expect(screen.getByText('Problem')).toBeInTheDocument();
    unmount();

    const second = render(
      <Notice tone="error" label="Upload failed">
        Boom.
      </Notice>,
    );
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.queryByText('Problem')).not.toBeInTheDocument();
    second.unmount();

    render(
      <Notice tone="error" label="">
        Boom.
      </Notice>,
    );
    expect(screen.queryByText('Problem')).not.toBeInTheDocument();
  });
});
