import { raceController } from './services/app-services'

App({
  onShow() {
    void raceController.autoConnect()
  },
})
