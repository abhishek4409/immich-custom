<script lang="ts">
  import { Heading, immichLogo, Logo, VStack } from '@immich/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    children?: Snippet;
  }

  let { title, children }: Props = $props();

  // these come from a folder mounted on the server, the colorful backdrop stays visible when they are missing
  const photos = '/login-background';
  let photoLoaded = $state(false);
</script>

<section class="relative isolate flex min-h-dvh w-full items-end justify-center md:items-center md:justify-end">
  <div class="fixed inset-0 -z-10 flex place-content-center place-items-center">
    <img src={immichLogo} class="mx-auto mb-2 h-full max-w-(--breakpoint-md) overflow-hidden antialiased" alt="" />
    <div class="absolute inset-0 bg-transparent backdrop-blur-[200px] dark:bg-immich-dark-bg/20"></div>
  </div>

  <picture>
    <source media="(orientation: portrait)" srcset="{photos}/portrait-1080.webp" />
    <img
      src="{photos}/landscape-1920.webp"
      srcset="{photos}/landscape-1920.webp 1920w, {photos}/landscape-2560.webp 2560w, {photos}/landscape-3840.webp 3840w"
      sizes="100vw"
      alt=""
      class={[
        'fixed inset-0 -z-10 size-full object-cover transition-opacity duration-500',
        photoLoaded ? 'opacity-100' : 'opacity-0',
      ]}
      onload={() => (photoLoaded = true)}
    />
  </picture>

  <div
    class="flex w-full flex-col justify-center gap-4 rounded-t-3xl border-t border-white/60 bg-white/70 p-6 text-dark shadow-lg backdrop-blur-xl backdrop-saturate-150 md:my-6 md:me-[5vw] md:min-h-[86dvh] md:w-md md:gap-6 md:rounded-3xl md:border md:p-8 dark:border-white/15 dark:bg-black/60 dark:text-white"
  >
    <VStack>
      <Logo variant="icon" size="large" class="md:h-24" />
      <Heading size="large" class="font-semibold" color="primary" tag="h1">{title}</Heading>
    </VStack>

    {@render children?.()}
  </div>
</section>
