import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'br.com.beenk.autopro',
  appName: 'AutoPro',
  webDir: '.output/public',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#020618',
      showSpinner: false
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#020618'
    }
  },
  ios: {
    contentInset: 'automatic'
  },
  android: {
    backgroundColor: '#020618'
  }
}

export default config
