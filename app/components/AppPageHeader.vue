<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  showNotifications?: boolean
}>(), {
  showNotifications: true
})
</script>

<template>
  <UDashboardNavbar :title="title">
    <template #leading>
      <AppSidebarCollapse />
      <slot name="leading" />
    </template>

    <template v-if="showNotifications || !!$slots.right" #right>
      <div class="flex items-center gap-2">
        <slot name="right" />
        <NotificationsButton v-if="showNotifications" />
      </div>
    </template>
  </UDashboardNavbar>
</template>
