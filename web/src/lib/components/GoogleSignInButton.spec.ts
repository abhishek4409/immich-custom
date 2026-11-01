import userEvent from '@testing-library/user-event';
import { renderWithTooltips } from '$tests/helpers';
import GoogleSignInButton from './GoogleSignInButton.svelte';

describe('GoogleSignInButton component', () => {
  it('shows the text and the logo', () => {
    const { getByRole } = renderWithTooltips(GoogleSignInButton, { text: 'Sign in with Google', onclick: vi.fn() });

    const button = getByRole('button', { name: 'Sign in with Google' });
    expect(button.querySelector('svg[viewBox="0 0 48 48"]')).not.toBeNull();
  });

  it('calls onclick when clicked', async () => {
    const onclick = vi.fn();
    const { getByRole } = renderWithTooltips(GoogleSignInButton, { text: 'Sign in with Google', onclick });

    await userEvent.setup().click(getByRole('button'));

    expect(onclick).toHaveBeenCalledOnce();
  });

  it('replaces the logo and blocks clicks while loading', async () => {
    const onclick = vi.fn();
    const { getByRole } = renderWithTooltips(GoogleSignInButton, {
      text: 'Sign in with Google',
      loading: true,
      onclick,
    });

    const button = getByRole('button');
    expect(button.querySelector('svg[viewBox="0 0 48 48"]')).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await userEvent.setup().click(button);

    expect(onclick).not.toHaveBeenCalled();
  });
});
