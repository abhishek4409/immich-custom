<script lang="ts">
  import { Heading, immichLogo, Logo } from '@immich/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    subtitle?: string;
    children?: Snippet;
  }

  let { title, subtitle, children }: Props = $props();

  // these come from a folder mounted on the server, the colorful backdrop stays visible when they are missing
  const photos = '/login-background';
  let photoLoaded = $state(false);
</script>

<section
  class="relative isolate flex min-h-dvh w-full items-end justify-center p-3 md:items-stretch md:justify-end md:p-0"
>
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
    class="flex w-full flex-col justify-center gap-5 rounded-[28px] border border-white/60 bg-white/35 p-5 text-[#1f1f1f] shadow-lg backdrop-blur-sm backdrop-saturate-150 [text-shadow:0_0_8px_rgb(255_255_255/0.9)] md:min-h-dvh md:w-110 md:gap-6 md:rounded-none md:border-0 md:border-s md:p-12 dark:border-white/15 dark:bg-black/30 dark:text-white dark:[text-shadow:0_0_8px_rgb(0_0_0/0.9)] [&_button]:text-shadow-none [&_input]:text-shadow-none"
  >
    <div class="flex items-center gap-3 md:flex-col md:items-start md:gap-3.5">
      <Logo variant="icon" size="large" class="h-11 shrink-0 md:h-10" />
      <div class="min-w-0">
        <Heading
          size="large"
          class="text-[19px]/6 font-semibold tracking-normal md:text-[28px] md:leading-[34px]"
          tag="h1"
        >
          {title}
        </Heading>
        {#if subtitle}
          <p class="text-[13px] leading-[18px] font-medium md:mt-1 md:text-sm">{subtitle}</p>
        {/if}
      </div>
    </div>

    {@render children?.()}
  </div>
</section>
