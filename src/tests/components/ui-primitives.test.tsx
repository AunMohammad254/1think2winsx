import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import DatePicker from '@/components/ui/DatePicker';
import DateTimePicker from '@/components/ui/DateTimePicker';

describe('shadcn primitives', () => {
  it('Button picks variant classes and can render as its child', () => {
    render(<><Button variant="destructive" size="sm">Delete</Button><Button asChild><a href="/x">Go</a></Button></>);
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('bg-destructive');
    expect(screen.getByRole('link', { name: 'Go' }).className).toContain('bg-primary');
  });

  it('Badge, Input, Textarea and Label pass props through', () => {
    render(
      <>
        <Badge variant="outline">New</Badge>
        <Label htmlFor="n">Name</Label>
        <Input id="n" defaultValue="Ali" className="extra" />
        <Textarea aria-label="Bio" defaultValue="Hi" />
      </>,
    );
    expect(screen.getByText('New').className).toContain('text-foreground');
    expect(screen.getByLabelText('Name')).toHaveValue('Ali');
    expect(screen.getByLabelText('Name').className).toContain('extra');
    expect(screen.getByLabelText('Bio')).toHaveValue('Hi');
  });

  it('Switch toggles', () => {
    const onChange = vi.fn();
    render(<Switch aria-label="Wallet" onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Wallet' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Tabs switch panels', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('Panel A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByText('Panel B')).toBeInTheDocument();
  });

  it('Card renders all its parts', () => {
    render(<Card><CardHeader><CardTitle>T</CardTitle><CardDescription>D</CardDescription></CardHeader><CardContent>C</CardContent><CardFooter>F</CardFooter></Card>);
    expect(screen.getByRole('heading', { name: 'T' })).toBeInTheDocument();
    for (const t of ['D', 'C', 'F']) expect(screen.getByText(t)).toBeInTheDocument();
  });

  it('Dialog opens with a title, description and a close button', async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm</DialogTitle><DialogDescription>Sure?</DialogDescription></DialogHeader>
          <DialogFooter>footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Sure?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// Fixed "today" so calendars are stable. Only Date is faked: framer-motion still gets real frames.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 10, 0));
});
afterEach(() => vi.useRealTimers());

const dayButton = (n: number) => screen.getAllByRole('button').find((b) => b.textContent === String(n))!;

describe('DatePicker', () => {
  it('opens 18 years back and picks a day', async () => {
    const onChange = vi.fn();
    render(<DatePicker id="dob" onChange={onChange} />);
    expect(screen.getByText('Select date')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select date' }));
    expect(screen.getByRole('button', { name: 'October' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2008' })).toBeInTheDocument();
    expect(screen.queryByText('Clear')).toBeNull();
    fireEvent.click(dayButton(5));
    expect(onChange).toHaveBeenCalledWith('2008-10-05');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'October' })).toBeNull());
  });

  it('marks the selected day and today, and moves between months', () => {
    const { rerender } = render(<DatePicker id="d" value="2026-10-03" onChange={vi.fn()} maxYear={2030} />);
    expect(screen.getByText('Oct 3, 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Oct 3, 2026'));
    expect(dayButton(3).className).toContain('from-purple-600');
    expect(dayButton(15).className).toContain('ring-purple-500/50');
    const [, prev, , , next] = screen.getAllByRole('button');
    fireEvent.click(next);
    expect(screen.getByRole('button', { name: 'November' })).toBeInTheDocument();
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(screen.getByRole('button', { name: 'September' })).toBeInTheDocument();
    rerender(<DatePicker id="d" value="2026-10-03" onChange={vi.fn()} maxYear={2030} />);
  });

  it('drills through years and months', async () => {
    render(<DatePicker id="d" value="2000-02-10" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Feb 10, 2000'));
    fireEvent.click(screen.getByRole('button', { name: 'February' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mar' }));
    expect(await screen.findByRole('button', { name: 'March' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2000' }));
    expect(await screen.findByText('1992 - 2003')).toBeInTheDocument();
    const nav = () => screen.getAllByRole('button');
    fireEvent.click(nav()[1]);
    expect(screen.getByText('1980 - 1991')).toBeInTheDocument();
    fireEvent.click(nav()[2]);
    fireEvent.click(screen.getByRole('button', { name: '1995' }));
    const yearBtn = await screen.findByRole('button', { name: '1995' });
    fireEvent.click(yearBtn);
    expect(await screen.findByText('1992 - 2003')).toBeInTheDocument();
  });

  it('leaves years after maxYear off the year page', async () => {
    render(<DatePicker id="d" value="2010-05-01" onChange={vi.fn()} maxYear={2013} />);
    fireEvent.click(screen.getByText('May 1, 2010'));
    fireEvent.click(screen.getByRole('button', { name: '2010' }));
    expect(await screen.findByText('2004 - 2013')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2013' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2014' })).toBeNull();
  });

  it('clears, jumps back, and closes on an outside click', async () => {
    const onChange = vi.fn();
    render(<div><span>outside</span><DatePicker id="d" value="2000-02-10" onChange={onChange} /></div>);
    const open = () => fireEvent.click(screen.getByText('Feb 10, 2000'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'February' }));
    fireEvent.click(await screen.findByText('Jump to 2007'));
    // the label says 2007 but it jumps 18 years back from today (2008 here)
    expect(await screen.findByRole('button', { name: '2008' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('outside'));
    await waitFor(() => expect(screen.queryByText('Jump to 2007')).toBeNull());
    open();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'October' }));
    expect(screen.getByText('Jump to 2007')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear'));
    expect(onChange).toHaveBeenCalledWith('');
    open();
    open();
    await waitFor(() => expect(screen.queryByText('Jump to 2007')).toBeNull());
  });
});

describe('DateTimePicker', () => {
  const selects = () => screen.getAllByRole('combobox') as HTMLSelectElement[];

  it('builds a local date-time from a day, hour, minute and AM/PM', () => {
    const onChange = vi.fn();
    render(<DateTimePicker id="when" onChange={onChange} />);
    fireEvent.click(screen.getByText('Select date and time'));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    fireEvent.change(selects()[0], { target: { value: '3' } }); // before a day: only remembered
    expect(dayButton(15).className).toContain('ring-purple-500/50');
    fireEvent.click(dayButton(20));
    expect(dayButton(20).className).toContain('from-purple-600');
    fireEvent.change(selects()[1], { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'AM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-20T03:30');
  });

  it('maps 12 AM to midnight and 12 PM to noon', () => {
    const onChange = vi.fn();
    render(<DateTimePicker onChange={onChange} />);
    fireEvent.click(screen.getByText('Select date and time'));
    fireEvent.click(dayButton(1));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01T12:00');
    fireEvent.click(screen.getByText('Select date and time'));
    fireEvent.click(dayButton(1));
    fireEvent.click(screen.getByRole('button', { name: 'AM' }));
    fireEvent.click(screen.getByRole('button', { name: 'PM' }));
    fireEvent.click(screen.getByRole('button', { name: 'AM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01T00:00');
  });

  it('shows 12 for a noon or midnight value', () => {
    const { unmount } = render(<DateTimePicker value="2027-03-05T12:00" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText(/Mar 5, 2027/));
    expect(selects()[0].value).toBe('12');
    expect(screen.getByRole('button', { name: 'PM' }).className).toContain('bg-purple-600');
    unmount();
    render(<DateTimePicker value="2027-03-05T00:30" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText(/Mar 5, 2027/));
    expect(selects().map((s) => s.value)).toEqual(['12', '30']);
    expect(screen.getByRole('button', { name: 'AM' }).className).toContain('bg-purple-600');
  });

  it('opens on an existing value and syncs the time fields', () => {
    render(<DateTimePicker value="2027-03-05T09:15" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText(/Mar 5, 2027/));
    expect(selects().map((s) => s.value)).toEqual(['9', '15']);
    expect(screen.getByRole('button', { name: 'AM' }).className).toContain('bg-purple-600');
    expect(screen.getByRole('button', { name: 'March' })).toBeInTheDocument();
  });

  it('KNOWN BUG: changing the time after browsing months moves the date to the viewed month', () => {
    const onChange = vi.fn();
    render(<DateTimePicker onChange={onChange} />);
    fireEvent.click(screen.getByText('Select date and time'));
    fireEvent.click(dayButton(20));
    fireEvent.click(screen.getAllByRole('button')[4]); // next month
    fireEvent.change(selects()[1], { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-11-20T12:45');
  });

  it('browses months and years, jumps to today, clears and closes outside', async () => {
    const onChange = vi.fn();
    render(<div><span>outside</span><DateTimePicker value="2027-03-05T21:00" onChange={onChange} /></div>);
    const open = () => fireEvent.click(screen.getByText(/Mar 5, 2027/));
    open();
    expect(screen.getByRole('button', { name: 'PM' }).className).toContain('bg-purple-600');
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(screen.getByRole('button', { name: 'February' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'February' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Jun' }));
    expect(await screen.findByRole('button', { name: 'June' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2027' }));
    expect(await screen.findByText('2016 - 2027')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[2]);
    expect(screen.getByText('2028 - 2031')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[1]);
    fireEvent.click(screen.getByRole('button', { name: '2026' }));
    fireEvent.click(await screen.findByRole('button', { name: '2026' }));
    expect(await screen.findByText('2016 - 2027')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('button', { name: 'October' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('outside'));
    await waitFor(() => expect(screen.queryByText('Today')).toBeNull());
    open();
    fireEvent.mouseDown(screen.getByText('Today'));
    fireEvent.click(screen.getByText('Clear'));
    expect(onChange).toHaveBeenCalledWith('');
    open();
    open();
    await waitFor(() => expect(screen.queryByText('Today')).toBeNull());
  });
});
