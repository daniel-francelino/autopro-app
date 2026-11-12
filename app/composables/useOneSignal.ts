import type {
  NotificationAppContext,
  NotificationPermission,
  NotificationPlatform,
  NotificationPushChannel,
  NotificationSubscriptionSyncPayload
} from '~/types/notifications'

type OneSignalState = {
  bootstrapped: boolean
  initialized: boolean
  supported: boolean
  appContext: NotificationAppContext
  platform: NotificationPlatform
  permission: NotificationPermission
  subscribed: boolean
  deviceKey: string | null
  subscriptionId: string | null
  userId: string | null
  token: string | null
  sdkVersion: string | null
  appVersion: string | null
  deviceModel: string | null
  language: string | null
  timezone: string | null
}

const DEVICE_KEY_STORAGE = 'autopro.onesignal.device-key'
const SUBSCRIBED_STORAGE = 'autopro.onesignal.subscribed'

function defaultState(): OneSignalState {
  return {
    bootstrapped: false,
    initialized: false,
    supported: false,
    appContext: 'browser',
    platform: 'web',
    permission: 'default',
    subscribed: false,
    deviceKey: null,
    subscriptionId: null,
    userId: null,
    token: null,
    sdkVersion: null,
    appVersion: null,
    deviceModel: null,
    language: null,
    timezone: null
  }
}

function mapPermission(value: NotificationPermission | undefined): NotificationPermission {
  if (value === 'granted' || value === 'denied' || value === 'default')
    return value

  return 'unsupported'
}

function isNativeEnvironment() {
  if (!import.meta.client)
    return false

  const capacitor = (window as typeof window & {
    Capacitor?: { isNativePlatform?: () => boolean, getPlatform?: () => string }
  }).Capacitor

  return Boolean(capacitor?.isNativePlatform?.())
}

function resolveAppContext(): NotificationAppContext {
  if (!import.meta.client)
    return 'browser'

  if (isNativeEnvironment())
    return 'native'

  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (typeof navigator !== 'undefined' && 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))

  return isStandalone ? 'pwa' : 'browser'
}

function resolvePlatform(): NotificationPlatform {
  if (!import.meta.client)
    return 'web'

  if (!isNativeEnvironment())
    return 'web'

  const capacitor = (window as typeof window & {
    Capacitor?: { getPlatform?: () => string }
  }).Capacitor
  const platform = capacitor?.getPlatform?.()

  if (platform === 'ios' || platform === 'android')
    return platform

  return 'web'
}

function supportsPush(appContext: NotificationAppContext) {
  if (!import.meta.client)
    return false

  if (appContext === 'native')
    return false

  return 'Notification' in window && 'serviceWorker' in navigator
}

function getStoredSubscribed() {
  if (!import.meta.client)
    return false

  return localStorage.getItem(SUBSCRIBED_STORAGE) === 'true'
}

function setStoredSubscribed(value: boolean) {
  if (!import.meta.client)
    return

  localStorage.setItem(SUBSCRIBED_STORAGE, value ? 'true' : 'false')
}

function getDeviceKey() {
  if (!import.meta.client)
    return null

  const stored = localStorage.getItem(DEVICE_KEY_STORAGE)
  if (stored)
    return stored

  const deviceKey = crypto.randomUUID()
  localStorage.setItem(DEVICE_KEY_STORAGE, deviceKey)
  return deviceKey
}

export function useOneSignal() {
  const runtimeConfig = useRuntimeConfig()
  const state = useState<OneSignalState>('onesignal-state', defaultState)
  const isEnabled = computed(() => Boolean(runtimeConfig.public.oneSignalEnabled && runtimeConfig.public.oneSignalAppId))
  const isNative = computed(() => state.value.appContext === 'native')
  const isSubscribed = computed(() => state.value.subscribed)

  async function refreshState() {
    const appContext = resolveAppContext()
    const platform = resolvePlatform()
    const supported = supportsPush(appContext)
    const permission = supported ? mapPermission(Notification.permission) : 'unsupported'
    const subscribed = supported && permission === 'granted' && getStoredSubscribed()

    state.value = {
      ...state.value,
      initialized: true,
      supported,
      appContext,
      platform,
      permission,
      subscribed,
      deviceKey: getDeviceKey(),
      language: import.meta.client ? navigator.language : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
    }
  }

  async function bootstrap() {
    if (!import.meta.client || state.value.bootstrapped)
      return

    state.value.bootstrapped = true
    await refreshState()
  }

  function currentChannel(): NotificationPushChannel {
    return isNative.value ? 'mobile_push' : 'web_push'
  }

  async function syncCurrentDevice() {
    if (!import.meta.client || !isEnabled.value)
      return

    if (!state.value.initialized)
      await refreshState()

    const payload: NotificationSubscriptionSyncPayload = {
      provider: 'onesignal',
      deviceKey: state.value.deviceKey ?? getDeviceKey() ?? 'unknown-device',
      channel: currentChannel(),
      platform: state.value.platform,
      appContext: state.value.appContext,
      oneSignalSubscriptionId: state.value.subscriptionId,
      oneSignalUserId: state.value.userId,
      token: state.value.token,
      permission: state.value.permission,
      optedIn: state.value.subscribed,
      sdkVersion: state.value.sdkVersion,
      appVersion: state.value.appVersion,
      deviceModel: state.value.deviceModel,
      language: state.value.language,
      timezone: state.value.timezone
    }

    await $fetch('/api/settings/notifications/device', {
      method: 'POST',
      body: payload
    })
  }

  async function enableCurrentDevice() {
    if (!import.meta.client)
      return

    if (!isEnabled.value) {
      await refreshState()
      return
    }

    const appContext = resolveAppContext()
    if (!supportsPush(appContext)) {
      await refreshState()
      return
    }

    const permission = mapPermission(await Notification.requestPermission())
    setStoredSubscribed(permission === 'granted')
    await refreshState()

    if (permission === 'granted')
      await syncCurrentDevice()
  }

  async function disableCurrentDevice() {
    setStoredSubscribed(false)
    await refreshState()
    await syncCurrentDevice()
  }

  return {
    state: readonly(state),
    isEnabled,
    isNative,
    isSubscribed,
    bootstrap,
    refreshState,
    enableCurrentDevice,
    disableCurrentDevice,
    syncCurrentDevice
  }
}
