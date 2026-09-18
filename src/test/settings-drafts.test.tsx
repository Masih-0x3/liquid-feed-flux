import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSettingsDrafts, SettingsDraftGuard, SettingsSaveStatus, useSettingsDraft, useSettingsSave } from '@/components/settings/SettingsDrafts';
import { reconcileSettingsDraftIdentity } from '@/components/settings/SettingsDraftSession';

function Editor({ incoming = { text: 'saved' }, persist = async () => undefined }: { incoming?: { text: string }; persist?: (value: { text: string }) => Promise<unknown> }) {
  const editor = useSettingsDraft('test-group', 'Test group', incoming);
  const saving = useSettingsSave(editor, persist);
  return <><input aria-label="Draft text" value={editor.draft.text} onChange={(event) => editor.updateDraft({ text: event.target.value })} /><SettingsSaveStatus label="Test group" dirty={editor.isDirty} {...saving} onSave={() => { void saving.save(); }} />{editor.hasPendingIncoming && <><p>New server snapshot</p><button onClick={editor.reloadIncoming}>Reload server snapshot</button></>}</>;
}

beforeEach(clearSettingsDrafts);
afterEach(() => { act(clearSettingsDrafts); });

describe('Settings draft lifecycle', () => {
  it('retains an unfinished group through unmount and restores it without writing to storage', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const first = render(<Editor />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished' } });
    first.unmount();
    render(<Editor />);
    expect(screen.getByRole('textbox')).toHaveValue('unfinished');
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });

  it('preserves a dirty draft when a new server snapshot arrives', () => {
    const view = render(<Editor />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'local' } });
    view.rerender(<Editor incoming={{ text: 'server change' }} />);
    expect(screen.getByRole('textbox')).toHaveValue('local');
    expect(screen.getByText('New server snapshot')).toBeInTheDocument();
  });

  it('retains an unresolved server conflict when switching panels', () => {
    const first = render(<Editor />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'local' } });
    first.rerender(<Editor incoming={{ text: 'server change' }} />);
    first.unmount();
    render(<Editor incoming={{ text: 'server change' }} />);
    expect(screen.getByRole('textbox')).toHaveValue('local');
    expect(screen.getByText('New server snapshot')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload server snapshot' }));
    expect(screen.getByRole('textbox')).toHaveValue('server change');
    expect(screen.queryByText('New server snapshot')).not.toBeInTheDocument();
  });

  it('retains edits on failure and retries the same scope', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    render(<Editor persist={persist} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Test group' }));
    await screen.findByText(/Save failed/);
    expect(screen.getByRole('textbox')).toHaveValue('local');
    fireEvent.click(screen.getByRole('button', { name: 'Save Test group' }));
    await waitFor(() => expect(screen.getByText(/Saved\./)).toBeInTheDocument());
    expect(persist).toHaveBeenLastCalledWith({ text: 'local' });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not acknowledge edits made while a save is in flight', async () => {
    let finish!: () => void;
    const persist = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<Editor persist={persist} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'submitted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Test group' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'newer draft' } });
    await act(async () => { finish(); });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({ text: 'submitted' });
    expect(screen.getByRole('textbox')).toHaveValue('newer draft');
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  });

  it('acknowledges a save after leaving its panel and ignores a stale pre-save snapshot on return', async () => {
    let finish!: () => void;
    const persist = () => new Promise<void>((resolve) => { finish = resolve; });
    const first = render(<Editor persist={persist} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'submitted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Test group' }));
    first.unmount();
    await act(async () => { finish(); });
    render(<Editor />);
    expect(screen.getByRole('textbox')).toHaveValue('submitted');
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
  });

  it('does not let a late save repopulate the cache after an authentication change', async () => {
    let finish!: () => void;
    const first = render(<Editor persist={() => new Promise<void>((resolve) => { finish = resolve; })} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'previous user' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Test group' }));
    first.unmount();
    clearSettingsDrafts();
    render(<Editor incoming={{ text: 'next user' }} />);
    await act(async () => { finish(); });
    expect(screen.getByRole('textbox')).toHaveValue('next user');
  });

  it('retains the same identity, clears on account replacement, and clears when access expires', () => {
    reconcileSettingsDraftIdentity('operator-a', 'authorised');
    const first = render(<Editor />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'operator-a draft' } });
    first.unmount();
    reconcileSettingsDraftIdentity('operator-a', 'authorised');
    const sameIdentity = render(<Editor />);
    expect(screen.getByRole('textbox')).toHaveValue('operator-a draft');
    sameIdentity.unmount();

    reconcileSettingsDraftIdentity('operator-b', 'authorised');
    const nextIdentity = render(<Editor incoming={{ text: 'operator-b baseline' }} />);
    expect(screen.getByRole('textbox')).toHaveValue('operator-b baseline');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'operator-b draft' } });
    nextIdentity.unmount();
    reconcileSettingsDraftIdentity(null, 'unauthenticated');
    reconcileSettingsDraftIdentity('operator-b', 'authorised');
    render(<Editor incoming={{ text: 'operator-b baseline' }} />);
    expect(screen.getByRole('textbox')).toHaveValue('operator-b baseline');
  });

  it('lets an operator cancel leaving Settings and clears drafts at sign-out', async () => {
    function Page() {
      const [editing, setEditing] = useState(true);
      return <MemoryRouter initialEntries={['/settings']}><SettingsDraftGuard />{editing && <Editor />}<a href="/monitoring">Monitoring</a><button onClick={() => { clearSettingsDrafts(); setEditing(false); }}>Sign out fixture</button></MemoryRouter>;
    }
    render(<Page />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private draft' } });
    fireEvent.click(screen.getByRole('link', { name: 'Monitoring' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox')).toHaveValue('private draft');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out fixture' }));
    const clean = render(<Editor />);
    expect(screen.getByRole('textbox')).toHaveValue('saved');
    clean.unmount();
  });
});
