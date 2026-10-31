<script lang="ts">
  import { goto } from '$app/navigation';
  import { OpenQueryParam, QueryParameter } from '$lib/constants';
  import LinkedOAuthAccounts from '$lib/components/user-settings-page/LinkedOAuthAccounts.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { oauth } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { UserOAuthIdentityStatus, type UserOAuthIdentityListResponseDto } from '@immich/sdk';
  import { Button, LoadingSpinner, toastManager } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  let loading = $state(true);
  let list = $state<UserOAuthIdentityListResponseDto>();

  // an account with no linked accounts can always link its first one
  const canLink = $derived(
    !!list?.canManage &&
      (list.sharingEnabled || list.identities.every(({ status }) => status !== UserOAuthIdentityStatus.Active)),
  );

  onMount(async () => {
    if (oauth.isCallback(location)) {
      try {
        loading = true;
        const response = await oauth.link(location);
        authManager.setUser(response);
        toastManager.primary($t('linked_oauth_account'));
      } catch (error) {
        handleError(error, $t('errors.unable_to_link_oauth_account'));
      } finally {
        await goto(`?${QueryParameter.IS_OPEN}=${OpenQueryParam.OAUTH}`);
      }
    }

    loading = false;
  });
</script>

<section class="my-4">
  <div in:fade={{ duration: 500 }}>
    <div class="flex flex-col gap-4 sm:ms-8">
      {#if loading}
        <div class="flex place-content-center place-items-center">
          <LoadingSpinner />
        </div>
      {:else if featureFlagsManager.value.oauth}
        <LinkedOAuthAccounts isAdmin={authManager.user.isAdmin} onLoad={(value) => (list = value)} />

        <div class="flex justify-end gap-3">
          {#if serverConfigManager.value.oauthAccountManagementUrl}
            <Button
              shape="round"
              size="small"
              variant="outline"
              href={serverConfigManager.value.oauthAccountManagementUrl}>{$t('manage_oauth_account')}</Button
            >
          {/if}
          {#if canLink}
            <Button
              shape="round"
              size="small"
              variant="outline"
              onclick={() => oauth.authorize(location, { selectAccount: true })}
              >{list?.identities.length ? $t('linked_accounts_add_in_browser') : $t('link_to_oauth')}</Button
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>
</section>
