import { raceController } from './services/app-services'

App({
  onShow() {
    void raceController.syncForegroundState().catch(() => undefined)
  },
})
