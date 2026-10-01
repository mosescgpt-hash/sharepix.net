import { fireEvent, render, screen } from '@testing-library/react';
import FreeEventsChart from '@/components/FreeEventsChart';
import type { FreeEventDay } from '@/lib/quotaCounters';

/**
 * The chart's hover layer and its table view: the two ways a reader gets an
 * exact number out of it.
 */

const series: FreeEventDay[] = [
  { day: '2026-09-29', given: 25, refused: 6, limit: 25 },
  { day: '2026-09-30', given: 0, refused: 0, limit: null },
  { day: '2026-10-01', given: 4, refused: 0, limit: 25 },
];

describe('FreeEventsChart', () => {
  it('shows a day’s numbers on hover, and the carried-over limit on a quiet day', () => {
    render(<FreeEventsChart series={series} />);
    const busy = screen.getByLabelText(/6 turned away/);
    fireEvent.mouseEnter(busy);
    expect(screen.getByRole('status')).toHaveTextContent('25 given out');
    expect(screen.getByRole('status')).toHaveTextContent('6 turned away');

    // Nobody asked on the 30th, but it still ran under the limit.
    fireEvent.focus(screen.getByLabelText(/0 given out, 0 turned away$/));
    expect(screen.getByRole('status')).toHaveTextContent('Limit 25');
  });

  it('has every number in a table as well', () => {
    render(<FreeEventsChart series={series} />);
    expect(screen.getByText('Show as a table')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(series.length + 1);
  });

  it('draws nothing for an empty series', () => {
    const { container } = render(<FreeEventsChart series={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
