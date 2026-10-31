import { fireEvent, render } from '@testing-library/svelte';
import LoginPageLayout from './LoginPageLayout.svelte';

describe('LoginPageLayout component', () => {
  const getPhoto = (container: Element) => container.querySelector(':scope picture img') as HTMLImageElement;

  it('offers a portrait photo and three landscape sizes', () => {
    const { container } = render(LoginPageLayout, { title: 'Login' });

    expect(container.querySelector('source')?.getAttribute('srcset')).toBe('/login-background/portrait-1080.webp');
    expect(getPhoto(container).getAttribute('srcset')).toBe(
      '/login-background/landscape-1920.webp 1920w, /login-background/landscape-2560.webp 2560w, /login-background/landscape-3840.webp 3840w',
    );
  });

  it('keeps the photo hidden until it loads', async () => {
    const { container } = render(LoginPageLayout, { title: 'Login' });
    const photo = getPhoto(container);

    expect(photo.classList).toContain('opacity-0');

    await fireEvent.load(photo);

    expect(photo.classList).toContain('opacity-100');
  });

  it('keeps the photo hidden when it fails to load', async () => {
    const { container } = render(LoginPageLayout, { title: 'Login' });
    const photo = getPhoto(container);

    await fireEvent.error(photo);

    expect(photo.classList).toContain('opacity-0');
  });
});
